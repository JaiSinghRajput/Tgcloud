import { BackupEngine } from '../src/domain/backup/engine';
import { InMemoryDatabaseRepository } from '../src/domain/database/repository';
import { DbMediaItem } from '../src/domain/database/types';
import { MediaState, NetworkPolicy } from '../src/domain/backup/stateMachine';

describe('Persistent Backup Engine & Transfer Coordination', () => {
  let repo: InMemoryDatabaseRepository;
  let mockUploader: jest.Mock;
  let mockReconciler: jest.Mock;
  let engine: BackupEngine;

  const samplePhoto: DbMediaItem = {
    id: 'media-engine-1',
    sourceKey: 'content://media/1',
    mediaType: 'photo',
    displayName: 'IMG_ENGINE_1.jpg',
    relativePath: 'DCIM/Camera/IMG_ENGINE_1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2500000,
    modifiedAtMs: 1792600000000,
    createdAtMs: 1792600000000,
    contentHash: 'hash-eng-1',
    state: MediaState.DISCOVERED,
    isExcluded: false,
    lastScannedAtMs: Date.now(),
    createdAtMsLocal: Date.now(),
    updatedAtMsLocal: Date.now(),
  };

  beforeEach(() => {
    repo = new InMemoryDatabaseRepository();
    mockUploader = jest.fn().mockResolvedValue({
      channelId: '-1001234567890',
      messageId: '55',
      contentHash: 'hash-eng-1',
    });
    mockReconciler = jest.fn().mockResolvedValue(null);
    engine = new BackupEngine(repo, mockUploader, mockReconciler);
  });

  it('persists upload jobs in SQLite before transfer dispatch starts', async () => {
    await repo.upsertMediaItem(samplePhoto);

    const jobs = await engine.queueMediaForBackup(['media-engine-1']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].mediaItemId).toBe('media-engine-1');

    const updatedMedia = await repo.getMediaItem('media-engine-1');
    expect(updatedMedia?.state).toBe(MediaState.QUEUED);
  });

  it('enforces Wi-Fi-only network policy: sets items to WaitingForNetwork if Wi-Fi disconnected', async () => {
    await repo.upsertMediaItem(samplePhoto);
    await engine.queueMediaForBackup(['media-engine-1']);

    // Attempt backup with WIFI_ONLY but isWifiConnected = false
    const outcome = await engine.runQueue(NetworkPolicy.WIFI_ONLY, false);

    expect(outcome.processed).toBe(0);
    expect(mockUploader).not.toHaveBeenCalled();

    const updatedMedia = await repo.getMediaItem('media-engine-1');
    expect(updatedMedia?.state).toBe(MediaState.WAITING_FOR_NETWORK);
  });

  it('processes queued jobs on permitted network and verifies remote success before marking BackedUp', async () => {
    await repo.upsertMediaItem(samplePhoto);
    await engine.queueMediaForBackup(['media-engine-1']);

    const progressLogs: any[] = [];
    const outcome = await engine.runQueue(NetworkPolicy.WIFI_ONLY, true, {
      onProgress: p => progressLogs.push(p),
    });

    expect(outcome.processed).toBe(1);
    expect(outcome.succeeded).toBe(1);
    expect(mockUploader).toHaveBeenCalledTimes(1);

    const updatedMedia = await repo.getMediaItem('media-engine-1');
    expect(updatedMedia?.state).toBe(MediaState.BACKED_UP);

    const tgObj = await repo.getTelegramObjectForMedia('media-engine-1');
    expect(tgObj).not.toBeNull();
    expect(tgObj?.messageId).toBe('55');
  });

  it('handles transient network failure with retry backoff and sets RetryPending', async () => {
    await repo.upsertMediaItem(samplePhoto);
    await engine.queueMediaForBackup(['media-engine-1']);

    mockUploader.mockRejectedValueOnce(
      new Error('NETWORK_TIMEOUT_429_FLOOD_WAIT'),
    );

    const outcome = await engine.runQueue(NetworkPolicy.WIFI_ONLY, true);
    expect(outcome.failed).toBe(1);

    const updatedMedia = await repo.getMediaItem('media-engine-1');
    expect(updatedMedia?.state).toBe(MediaState.RETRY_PENDING);
  });

  it('handles permanent failure by marking item PermanentFailure without infinite retries', async () => {
    await repo.upsertMediaItem(samplePhoto);
    await engine.queueMediaForBackup(['media-engine-1']);

    mockUploader.mockRejectedValueOnce(new Error('AUTH_KEY_UNREGISTERED'));

    const outcome = await engine.runQueue(NetworkPolicy.WIFI_ONLY, true);
    expect(outcome.failed).toBe(1);

    const updatedMedia = await repo.getMediaItem('media-engine-1');
    expect(updatedMedia?.state).toBe(MediaState.PERMANENT_FAILURE);
  });

  it('pause stops execution immediately while preserving queue records in SQLite', async () => {
    await repo.upsertMediaItem(samplePhoto);
    await engine.queueMediaForBackup(['media-engine-1']);

    engine.pause();
    expect(engine.getPaused()).toBe(true);

    const outcome = await engine.runQueue(NetworkPolicy.WIFI_ONLY, true);
    expect(outcome.processed).toBe(0);

    // Queue record still intact in SQLite
    const media = await repo.getMediaItem('media-engine-1');
    expect(media?.state).toBe(MediaState.QUEUED);
  });

  it('reconciles stale jobs left in Uploading/Verifying after crash to avoid duplicate messages', async () => {
    // Simulate item left in Uploading after process was killed mid-transfer
    await repo.upsertMediaItem({
      ...samplePhoto,
      state: MediaState.UPLOADING,
    });

    // Case 1: Remote reconciler finds that the upload DID succeed before the app died!
    mockReconciler.mockResolvedValueOnce({
      channelId: '-1001234567890',
      messageId: '777',
    });

    const result = await engine.reconcileStaleJobs();
    expect(result.reconciledBackedUp).toBe(1);
    expect(result.resetToQueued).toBe(0);

    const media = await repo.getMediaItem('media-engine-1');
    expect(media?.state).toBe(MediaState.BACKED_UP);

    const tgObj = await repo.getTelegramObjectForMedia('media-engine-1');
    expect(tgObj?.messageId).toBe('777');
  });

  it('reconciles uncompleted stale jobs after crash by safely resetting to Queued', async () => {
    // Simulate item left in Verifying, but remote reconciler confirms it did not complete
    await repo.upsertMediaItem({
      ...samplePhoto,
      id: 'media-stale-2',
      state: MediaState.VERIFYING,
    });

    mockReconciler.mockResolvedValueOnce(null);

    const result = await engine.reconcileStaleJobs();
    expect(result.reconciledBackedUp).toBe(0);
    expect(result.resetToQueued).toBe(1);

    const media = await repo.getMediaItem('media-stale-2');
    expect(media?.state).toBe(MediaState.QUEUED);
  });
});
