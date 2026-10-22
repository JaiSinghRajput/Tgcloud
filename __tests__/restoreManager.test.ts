import { RestoreManager } from '../src/domain/restore/restoreManager';
import { InMemoryDatabaseRepository } from '../src/domain/database/repository';
import { TelegramHistoryItem } from '../src/types/telegram';
import { ConflictPolicy, MediaState } from '../src/domain/backup/stateMachine';

describe('Restore Manager & Remote Index Recovery (Phase 6)', () => {
  let repo: InMemoryDatabaseRepository;
  let restoreManager: RestoreManager;

  const mockHistoryItems: TelegramHistoryItem[] = [
    {
      messageId: '101',
      chatId: '-100123456789',
      fileId: 501,
      mediaId: 'media-rec-1',
      mediaType: 'photo',
      originalName: 'IMG_20261022.jpg',
      relativePath: 'DCIM/Camera/IMG_20261022.jpg',
      sizeBytes: 3_200_000,
      modifiedAtMs: 1792660000000,
      contentHash: 'hash-rec-1',
      date: 1792660000,
    },
    {
      messageId: '102',
      chatId: '-100123456789',
      fileId: 502,
      mediaId: 'media-rec-2',
      mediaType: 'video',
      originalName: 'VID_20261022.mp4',
      relativePath: 'Movies/VID_20261022.mp4',
      sizeBytes: 42_000_000,
      modifiedAtMs: 1792665000000,
      contentHash: 'hash-rec-2',
      date: 1792665000,
    },
  ];

  beforeEach(() => {
    repo = new InMemoryDatabaseRepository();
    restoreManager = new RestoreManager(repo);
  });

  describe('Gate B: Remote Index Recovery on Clean Install', () => {
    it('rebuilds local media index from remote Telegram channel history from scratch', async () => {
      // Empty database initially
      const initialItems = await repo.listMediaItems();
      expect(initialItems).toHaveLength(0);

      // Rebuild index from channel history
      const { indexedCount, duplicateCount } =
        await restoreManager.rebuildIndexFromRemoteHistory(mockHistoryItems);

      expect(indexedCount).toBe(2);
      expect(duplicateCount).toBe(0);

      // Verify rebuilt records
      const item1 = await repo.getMediaItem('media-rec-1');
      expect(item1).not.toBeNull();
      expect(item1?.displayName).toBe('IMG_20261022.jpg');
      expect(item1?.relativePath).toBe('DCIM/Camera/IMG_20261022.jpg');
      expect(item1?.state).toBe(MediaState.BACKED_UP);

      const item2 = await repo.getMediaItem('media-rec-2');
      expect(item2).not.toBeNull();
      expect(item2?.mediaType).toBe('video');
      expect(item2?.state).toBe(MediaState.BACKED_UP);

      // Verify remote reference mapping
      const tgObj = await repo.getTelegramObjectForMedia('media-rec-1');
      expect(tgObj?.messageId).toBe('101');
      expect(tgObj?.channelId).toBe('-100123456789');
    });

    it('safely handles repeated index rebuilds without creating duplicates', async () => {
      await restoreManager.rebuildIndexFromRemoteHistory(mockHistoryItems);
      const secondRun = await restoreManager.rebuildIndexFromRemoteHistory(
        mockHistoryItems,
      );

      expect(secondRun.indexedCount).toBe(0);
      expect(secondRun.duplicateCount).toBe(2);
    });
  });

  describe('Collision Policy Handling', () => {
    const existingFiles = new Set([
      '/storage/emulated/0/DCIM/Camera/IMG_20261022.jpg',
    ]);

    const fileExistsFn = (p: string) => existingFiles.has(p);

    it('writes directly when target file does not exist locally', () => {
      const resolution = restoreManager.resolveConflict(
        '/storage/emulated/0/DCIM/Camera/NEW_PHOTO.jpg',
        ConflictPolicy.KEEP_BOTH,
        fileExistsFn,
      );
      expect(resolution.action).toBe('write');
      expect(resolution.finalPath).toBe(
        '/storage/emulated/0/DCIM/Camera/NEW_PHOTO.jpg',
      );
    });

    it('skips writing when file exists and policy is SKIP', () => {
      const resolution = restoreManager.resolveConflict(
        '/storage/emulated/0/DCIM/Camera/IMG_20261022.jpg',
        ConflictPolicy.SKIP,
        fileExistsFn,
      );
      expect(resolution.action).toBe('skip');
    });

    it('overwrites target when file exists and policy is REPLACE', () => {
      const resolution = restoreManager.resolveConflict(
        '/storage/emulated/0/DCIM/Camera/IMG_20261022.jpg',
        ConflictPolicy.REPLACE,
        fileExistsFn,
      );
      expect(resolution.action).toBe('write');
      expect(resolution.finalPath).toBe(
        '/storage/emulated/0/DCIM/Camera/IMG_20261022.jpg',
      );
    });

    it('generates incremented filename when file exists and policy is KEEP_BOTH', () => {
      const resolution = restoreManager.resolveConflict(
        '/storage/emulated/0/DCIM/Camera/IMG_20261022.jpg',
        ConflictPolicy.KEEP_BOTH,
        fileExistsFn,
      );
      expect(resolution.action).toBe('write');
      expect(resolution.finalPath).toBe(
        '/storage/emulated/0/DCIM/Camera/IMG_20261022 (1).jpg',
      );
    });
  });

  describe('Restoring Items and Missing Cloud Objects', () => {
    it('restores multiple items to target base directory with conflict resolution', async () => {
      const writtenPaths: string[] = [];
      const mockDownloader = jest
        .fn()
        .mockResolvedValue({ bytes: 1000, content: 'data' });
      const mockWriteFile = jest.fn().mockImplementation(async p => {
        writtenPaths.push(p);
      });

      const results = await restoreManager.restoreItems(
        mockHistoryItems,
        '/storage/emulated/0',
        ConflictPolicy.KEEP_BOTH,
        mockDownloader,
        () => false, // no conflict
        mockWriteFile,
      );

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('restored');
      expect(results[0].restoredPath).toBe(
        '/storage/emulated/0/DCIM/Camera/IMG_20261022.jpg',
      );
      expect(results[1].status).toBe('restored');
      expect(results[1].restoredPath).toBe(
        '/storage/emulated/0/Movies/VID_20261022.mp4',
      );
      expect(writtenPaths).toHaveLength(2);
    });

    it('handles missing cloud objects gracefully without terminating the entire batch', async () => {
      const mockDownloader = jest.fn().mockResolvedValueOnce(null); // missing object!

      const results = await restoreManager.restoreItems(
        [mockHistoryItems[0]],
        '/storage/emulated/0',
        ConflictPolicy.KEEP_BOTH,
        mockDownloader,
        () => false,
        jest.fn(),
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('missing');
      expect(results[0].restoredPath).toBeNull();
    });
  });

  describe('Gate E: Encrypted History Index Rebuild & Decryption Restore', () => {
    const masterKey = Buffer.alloc(32, 0x55);
    const plaintext = Buffer.from('Confidential Image Payload', 'utf8');
    const sensitiveMeta = {
      originalName: 'ConfidentialDoc.pdf',
      relativePath: 'Vault/ConfidentialDoc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: plaintext.length,
      modifiedAtMs: 1792680000000,
      contentHash: 'hash-secret-doc',
    };

    // Encrypt payload
    const { encryptedMedia, envelope } =
      require('../src/domain/crypto/encryptionService').encryptMediaPayload(
        plaintext,
        sensitiveMeta,
        masterKey,
      );

    const encryptedHistoryItem: TelegramHistoryItem = {
      messageId: '999',
      chatId: '-100123456789',
      fileId: 777,
      mediaId: 'enc-media-999',
      mediaType: 'photo',
      originalName: 'encrypted.bin',
      relativePath: '',
      sizeBytes: encryptedMedia.length,
      modifiedAtMs: 0,
      contentHash: undefined,
      date: 1792680000,
      encryptionEnvelope: envelope,
    };

    it('decrypts metadata during index rebuild when master key is supplied', async () => {
      const { indexedCount } =
        await restoreManager.rebuildIndexFromRemoteHistory(
          [encryptedHistoryItem],
          masterKey,
        );

      expect(indexedCount).toBe(1);
      const item = await repo.getMediaItem('enc-media-999');
      expect(item).not.toBeNull();
      expect(item?.displayName).toBe('ConfidentialDoc.pdf');
      expect(item?.relativePath).toBe('Vault/ConfidentialDoc.pdf');
    });

    it('safely marks encrypted items as locked when rebuilt without master key', async () => {
      const repoLocked = new InMemoryDatabaseRepository();
      const rmLocked = new RestoreManager(repoLocked);

      await rmLocked.rebuildIndexFromRemoteHistory([encryptedHistoryItem]); // no masterKey

      const item = await repoLocked.getMediaItem('enc-media-999');
      expect(item).not.toBeNull();
      expect(item?.displayName).toBe('Encrypted Item (Locked)');
    });

    it('decrypts media payload and restores original file when master key is provided', async () => {
      let writtenData: string | undefined;
      let writtenPath: string | undefined;

      const mockDownloader = jest.fn().mockResolvedValue({
        bytes: encryptedMedia.length,
        content: encryptedMedia.toString('base64'),
      });

      const mockWriteFile = jest
        .fn()
        .mockImplementation(async (path, content) => {
          writtenPath = path;
          writtenData = content;
        });

      const results = await restoreManager.restoreItems(
        [encryptedHistoryItem],
        '/storage/emulated/0',
        ConflictPolicy.KEEP_BOTH,
        mockDownloader,
        () => false,
        mockWriteFile,
        masterKey,
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('restored');
      expect(results[0].originalName).toBe('ConfidentialDoc.pdf');
      expect(writtenPath).toBe('/storage/emulated/0/Vault/ConfidentialDoc.pdf');
      expect(Buffer.from(writtenData!, 'base64').toString('utf8')).toBe(
        'Confidential Image Payload',
      );
    });

    it('fails gracefully when attempting to restore encrypted media without master key', async () => {
      const mockDownloader = jest.fn().mockResolvedValue({
        bytes: encryptedMedia.length,
        content: encryptedMedia.toString('base64'),
      });

      const results = await restoreManager.restoreItems(
        [encryptedHistoryItem],
        '/storage/emulated/0',
        ConflictPolicy.KEEP_BOTH,
        mockDownloader,
        () => false,
        jest.fn(),
        // no master key!
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('failed');
      expect(results[0].error).toContain('Decryption key required');
    });
  });
});
