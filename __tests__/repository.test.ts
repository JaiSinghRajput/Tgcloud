import { InMemoryDatabaseRepository } from '../src/domain/database/repository';
import { DbMediaItem } from '../src/domain/database/types';
import { MediaState, UploadJobState } from '../src/domain/backup/stateMachine';
import {
  MIGRATIONS,
  CURRENT_DATABASE_VERSION,
} from '../src/domain/database/schema';

describe('Database Repository & Schema Invariants', () => {
  let repo: InMemoryDatabaseRepository;

  beforeEach(() => {
    repo = new InMemoryDatabaseRepository();
  });

  it('defines valid initial migration V1 containing all 7 core tables', () => {
    const v1 = MIGRATIONS.find(m => m.version === CURRENT_DATABASE_VERSION);
    expect(v1).toBeDefined();
    const joinedSql = v1?.upSql.join(' ') || '';
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS media_items');
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS telegram_objects');
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS upload_jobs');
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS media_versions');
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS folder_exclusions');
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS backup_settings');
    expect(joinedSql).toContain('CREATE TABLE IF NOT EXISTS restore_jobs');
  });

  it('upserts media items and respects legal state transitions', async () => {
    const item: DbMediaItem = {
      id: 'media-001',
      sourceKey: 'content://media/external/images/media/101',
      mediaType: 'photo',
      displayName: 'IMG_001.jpg',
      relativePath: 'DCIM/Camera/IMG_001.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1540200,
      modifiedAtMs: 1792600000000,
      createdAtMs: 1792600000000,
      contentHash: 'hash-001',
      state: MediaState.DISCOVERED,
      isExcluded: false,
      lastScannedAtMs: Date.now(),
      createdAtMsLocal: Date.now(),
      updatedAtMsLocal: Date.now(),
    };

    const saved = await repo.upsertMediaItem(item);
    expect(saved.id).toBe('media-001');

    // Valid transition to Queued
    const queued = await repo.upsertMediaItem({
      ...saved,
      state: MediaState.QUEUED,
    });
    expect(queued.state).toBe(MediaState.QUEUED);

    // Invalid transition directly from Queued to BackedUp throws
    await expect(
      repo.upsertMediaItem({
        ...queued,
        state: MediaState.BACKED_UP,
      }),
    ).rejects.toThrow(/Illegal media state transition/);
  });

  it('creates upload jobs idempotently and prevents duplicate active jobs', async () => {
    const item: DbMediaItem = {
      id: 'media-002',
      mediaType: 'photo',
      displayName: 'IMG_002.jpg',
      relativePath: 'Pictures/IMG_002.jpg',
      sizeBytes: 900000,
      modifiedAtMs: 1792600000000,
      createdAtMs: 1792600000000,
      contentHash: 'hash-002',
      state: MediaState.DISCOVERED,
      isExcluded: false,
      lastScannedAtMs: Date.now(),
      createdAtMsLocal: Date.now(),
      updatedAtMsLocal: Date.now(),
    };
    await repo.upsertMediaItem(item);

    const job1 = await repo.createUploadJob('media-002', 1);
    const job2 = await repo.createUploadJob('media-002', 1);

    expect(job1.id).toBe(job2.id); // Same job returned, not duplicated!
  });

  it('claims pending jobs atomically and increments attempt count', async () => {
    const item: DbMediaItem = {
      id: 'media-003',
      mediaType: 'photo',
      displayName: 'IMG_003.jpg',
      relativePath: 'DCIM/Camera/IMG_003.jpg',
      sizeBytes: 1200000,
      modifiedAtMs: 1792600000000,
      createdAtMs: 1792600000000,
      state: MediaState.DISCOVERED,
      isExcluded: false,
      lastScannedAtMs: Date.now(),
      createdAtMsLocal: Date.now(),
      updatedAtMsLocal: Date.now(),
    };
    await repo.upsertMediaItem(item);
    const job = await repo.createUploadJob('media-003', 1);

    const claimed = await repo.claimNextUploadJob();
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.state).toBe(UploadJobState.CLAIMED);
    expect(claimed?.attemptCount).toBe(1);

    // Second claim returns null because no more pending jobs
    const none = await repo.claimNextUploadJob();
    expect(none).toBeNull();
  });

  it('transitions media item to BackedUp only when remote Telegram object is recorded', async () => {
    const item: DbMediaItem = {
      id: 'media-004',
      mediaType: 'photo',
      displayName: 'IMG_004.jpg',
      relativePath: 'DCIM/Camera/IMG_004.jpg',
      sizeBytes: 1400000,
      modifiedAtMs: 1792600000000,
      createdAtMs: 1792600000000,
      state: MediaState.DISCOVERED,
      isExcluded: false,
      lastScannedAtMs: Date.now(),
      createdAtMsLocal: Date.now(),
      updatedAtMsLocal: Date.now(),
    };
    await repo.upsertMediaItem(item);
    await repo.createUploadJob('media-004');

    // Simulate in-flight states
    await repo.upsertMediaItem({ ...item, state: MediaState.UPLOADING });
    await repo.upsertMediaItem({ ...item, state: MediaState.VERIFYING });

    // Record verified telegram object
    await repo.recordTelegramObject({
      id: 'obj-001',
      mediaItemId: 'media-004',
      channelId: '-100123456789',
      messageId: '42',
      metadataVersion: 1,
      contentHash: 'hash-004',
      uploadedAtMs: Date.now(),
      verifiedAtMs: Date.now(),
      status: 'available',
    });

    const updated = await repo.getMediaItem('media-004');
    expect(updated?.state).toBe(MediaState.BACKED_UP);
  });

  it('handles folder exclusions: marks non-backed up items as Excluded', async () => {
    const item1: DbMediaItem = {
      id: 'media-005',
      mediaType: 'photo',
      displayName: 'Screenshot_1.png',
      relativePath: 'Pictures/Screenshots/Screenshot_1.png',
      sizeBytes: 500000,
      modifiedAtMs: 1792600000000,
      createdAtMs: 1792600000000,
      state: MediaState.DISCOVERED,
      isExcluded: false,
      lastScannedAtMs: Date.now(),
      createdAtMsLocal: Date.now(),
      updatedAtMsLocal: Date.now(),
    };
    await repo.upsertMediaItem(item1);

    await repo.addFolderExclusion('Pictures/Screenshots', 'Screenshots');

    const updated = await repo.getMediaItem('media-005');
    expect(updated?.isExcluded).toBe(true);
    expect(updated?.state).toBe(MediaState.EXCLUDED);
  });

  it('derives dashboard metrics accurately from persisted states', async () => {
    // Add 1 discovered, 1 queued, 1 backed up, 1 excluded, 1 permanent failure
    await repo.upsertMediaItem({
      id: 'm1',
      mediaType: 'photo',
      displayName: 'm1.jpg',
      sizeBytes: 100,
      modifiedAtMs: 10,
      createdAtMs: 10,
      state: MediaState.DISCOVERED,
      isExcluded: false,
      lastScannedAtMs: 1,
      createdAtMsLocal: 1,
      updatedAtMsLocal: 1,
    });
    await repo.upsertMediaItem({
      id: 'm2',
      mediaType: 'photo',
      displayName: 'm2.jpg',
      sizeBytes: 100,
      modifiedAtMs: 10,
      createdAtMs: 10,
      state: MediaState.QUEUED,
      isExcluded: false,
      lastScannedAtMs: 1,
      createdAtMsLocal: 1,
      updatedAtMsLocal: 1,
    });
    await repo.upsertMediaItem({
      id: 'm3',
      mediaType: 'photo',
      displayName: 'm3.jpg',
      sizeBytes: 100,
      modifiedAtMs: 10,
      createdAtMs: 10,
      state: MediaState.EXCLUDED,
      isExcluded: true,
      lastScannedAtMs: 1,
      createdAtMsLocal: 1,
      updatedAtMsLocal: 1,
    });
    await repo.upsertMediaItem({
      id: 'm4',
      mediaType: 'photo',
      displayName: 'm4.jpg',
      sizeBytes: 100,
      modifiedAtMs: 10,
      createdAtMs: 10,
      state: MediaState.PERMANENT_FAILURE,
      isExcluded: false,
      lastScannedAtMs: 1,
      createdAtMsLocal: 1,
      updatedAtMsLocal: 1,
    });

    const m5 = await repo.upsertMediaItem({
      id: 'm5',
      mediaType: 'photo',
      displayName: 'm5.jpg',
      sizeBytes: 100,
      modifiedAtMs: 10,
      createdAtMs: 10,
      state: MediaState.QUEUED,
      isExcluded: false,
      lastScannedAtMs: 1,
      createdAtMsLocal: 1,
      updatedAtMsLocal: 1,
    });
    await repo.upsertMediaItem({ ...m5, state: MediaState.UPLOADING });
    await repo.upsertMediaItem({ ...m5, state: MediaState.VERIFYING });
    await repo.recordTelegramObject({
      id: 'obj-m5',
      mediaItemId: 'm5',
      channelId: '-100',
      messageId: '10',
      metadataVersion: 1,
      uploadedAtMs: 100,
      verifiedAtMs: 200,
      status: 'available',
    });

    const metrics = await repo.getDashboardMetrics();
    expect(metrics.totalDiscovered).toBe(5);
    expect(metrics.pending).toBe(1); // m2
    expect(metrics.backedUp).toBe(1); // m5
    expect(metrics.excluded).toBe(1); // m3
    expect(metrics.failed).toBe(1); // m4
    expect(metrics.lastBackupTimeMs).toBe(200);
  });
});
