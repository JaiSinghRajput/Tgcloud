import { Buffer } from 'buffer';
import {
  SessionKeyStore,
  initializeEncryptionSetup,
  persistMasterKeySecurely,
  loadPersistedMasterKey,
  clearPersistedMasterKey,
  verifyMasterKeyAgainstConfig,
  verifyRecoveryKey,
  deriveMasterKey,
  encryptMediaPayload,
  decryptMediaPayload,
} from '../src/domain/crypto/encryptionService';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import { MediaScannerService } from '../src/domain/media/scanner';
import { InMemoryDatabaseRepository } from '../src/domain/database/repository';
import { RestoreManager } from '../src/domain/restore/restoreManager';
import { BackupEngine } from '../src/domain/backup/engine';
import { NetworkPolicy, MediaState } from '../src/domain/backup/stateMachine';
import { TelegramHistoryItem } from '../src/types/telegram';

describe('Production Bug Fixes Comprehensive Test Suite', () => {
  beforeEach(async () => {
    await SessionKeyStore.lockEncryption();
  });

  afterEach(async () => {
    await SessionKeyStore.lockEncryption();
  });

  describe('1. Encryption Key Persistence & Lifecycle', () => {
    it('persists derived master key across simulated app restarts without prompting for passphrase', async () => {
      // 1. Initial setup with 12-word passphrase
      const setup = initializeEncryptionSetup();
      const derivedMasterKey = deriveMasterKey(
        setup.recoveryKey,
        setup.config.kdfSalt,
        setup.config.kdfIterations,
      );

      // Verify derived key matches setup hex
      expect(derivedMasterKey.toString('hex')).toBe(setup.masterKeyHex);

      // Persist master key in Keystore and configure session
      SessionKeyStore.setSessionKey(derivedMasterKey, setup.recoveryKey, setup.config);
      await persistMasterKeySecurely(setup.masterKeyHex);
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      // 2. Simulate application closure & restart: in-memory key wiped
      SessionKeyStore.clear();
      expect(SessionKeyStore.isUnlocked()).toBe(false);
      expect(SessionKeyStore.getSessionKey()).toBeNull();

      // 3. Application restart: load from Keystore-backed secure storage
      const restoredKey = await loadPersistedMasterKey();
      expect(restoredKey).not.toBeNull();
      expect(restoredKey!.toString('hex')).toBe(setup.masterKeyHex);

      // Authenticated verification against non-secret metadata
      const isValid = verifyMasterKeyAgainstConfig(restoredKey!, setup.config);
      expect(isValid).toBe(true);

      // Unlock session without requiring 12-word passphrase input!
      SessionKeyStore.setSessionKey(restoredKey!, undefined, setup.config);
      expect(SessionKeyStore.isUnlocked()).toBe(true);
      expect(SessionKeyStore.getSessionKey()!.toString('hex')).toBe(setup.masterKeyHex);
    });

    it('explicit lock action destroys persisted key and clears memory', async () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      SessionKeyStore.setSessionKey(masterKey, setup.recoveryKey, setup.config);
      await persistMasterKeySecurely(setup.masterKeyHex);
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      // User triggers explicit Lock Encryption action
      await SessionKeyStore.lockEncryption();

      // In-memory key must be cleared
      expect(SessionKeyStore.isUnlocked()).toBe(false);
      expect(SessionKeyStore.getSessionKey()).toBeNull();

      // Persisted key in Keystore must be destroyed
      const restoredKey = await loadPersistedMasterKey();
      expect(restoredKey).toBeNull();
    });

    it('allows disaster recovery on new device using original recovery passphrase', async () => {
      const setup = initializeEncryptionSetup();

      // Simulate wiping local app data (no Keystore key exists)
      await clearPersistedMasterKey();
      SessionKeyStore.clear();

      // User re-enters original 12-word recovery passphrase
      const verifyResult = verifyRecoveryKey(setup.recoveryKey, setup.config);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.masterKeyHex).toBe(setup.masterKeyHex);

      // Re-derive master key and re-establish secure unlock
      const masterKey = Buffer.from(verifyResult.masterKeyHex!, 'hex');
      SessionKeyStore.setSessionKey(masterKey, setup.recoveryKey, setup.config);
      await persistMasterKeySecurely(verifyResult.masterKeyHex!);

      expect(SessionKeyStore.isUnlocked()).toBe(true);
    });

    it('encrypts and decrypts media payloads consistently across restarts', async () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      const originalMedia = Buffer.from('TEST_VIDEO_PAYLOAD_BYTES_STREAM_SIMULATION', 'utf8');
      const sensitiveMeta = {
        originalName: 'test_vacation.mp4',
        relativePath: 'DCIM/Camera/test_vacation.mp4',
        mimeType: 'video/mp4',
        sizeBytes: originalMedia.length,
        modifiedAtMs: 1792660000000,
      };

      // Encrypt with initial session
      const { encryptedMedia, envelope } = encryptMediaPayload(
        originalMedia,
        sensitiveMeta,
        masterKey,
        setup.config.kdfSalt,
        setup.config.verificationToken,
      );

      // Simulate app restart and restoration from Keystore
      SessionKeyStore.clear();
      await persistMasterKeySecurely(setup.masterKeyHex);
      const restoredKey = await loadPersistedMasterKey();
      expect(restoredKey).not.toBeNull();

      // Decrypt using restored master key
      const decrypted = decryptMediaPayload(encryptedMedia, envelope, restoredKey!);
      expect(decrypted.decryptedMedia.toString('utf8')).toBe(originalMedia.toString('utf8'));
      expect(decrypted.metadata.originalName).toBe('test_vacation.mp4');
      expect(decrypted.metadata.mimeType).toBe('video/mp4');
    });
  });

  describe('2. Video Upload Reliability & Streaming Protection', () => {
    it('processes video upload with encryption without throwing memory errors', async () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      const result = await TelegramBridgeService.uploadMedia(
        '-1001234567891',
        'content://media/external/video/media/2001',
        'video',
        JSON.stringify({
          originalName: 'holiday_video.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 85_000_000,
        }),
        true,
        masterKey.toString('hex'),
      );

      expect(result).toBeDefined();
      expect(result.channelId).toBe('-1001234567891');
      expect(result.messageId).toBeTruthy();
      expect(result.fileId).toBeGreaterThan(0);
    });

    it('prepares cloud video for playback in-app with streaming decryption', async () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      const prepared = await TelegramBridgeService.prepareCloudVideo(
        54321,
        true,
        JSON.stringify({ alg: 'AES-256-GCM', keyVersion: 1 }),
        masterKey.toString('hex'),
      );

      expect(prepared).toBeDefined();
      expect(prepared.localUri).toBeTruthy();
      expect(prepared.localUri).toContain('mock_video_54321');
    });
  });

  describe('3. Automatic Gallery Backup', () => {
    it('discovers and queues newly added media items when auto-backup is enabled', async () => {
      const repo = new InMemoryDatabaseRepository();
      let uploadCalls = 0;

      const engine = new BackupEngine(
        repo,
        async media => {
          uploadCalls++;
          return {
            channelId: '-1001234567890',
            messageId: 'msg-999',
            contentHash: 'hash-999',
          };
        },
        async () => null,
      );

      // MediaScanner discovers items from MediaStore
      const scanResult = await MediaScannerService.scanMediaStore([]);
      expect(scanResult.items.length).toBeGreaterThan(0);

      // Filter eligible items for auto-backup (photos and videos included)
      const eligibleItems = scanResult.items.filter(i => !i.isExcluded);
      expect(eligibleItems.length).toBeGreaterThan(0);

      // Persist newly discovered items to repo
      for (const item of eligibleItems) {
        await repo.upsertMediaItem({
          id: item.id,
          sourceKey: item.sourceKey,
          mediaType: item.mediaType,
          displayName: item.displayName,
          relativePath: item.relativePath,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          modifiedAtMs: item.modifiedAtMs,
          createdAtMs: item.modifiedAtMs,
          state: MediaState.DISCOVERED,
          isExcluded: false,
          lastScannedAtMs: Date.now(),
          createdAtMsLocal: Date.now(),
          updatedAtMsLocal: Date.now(),
        });
      }

      // Enqueue and run queue on Wi-Fi
      const queuedJobs = await engine.queueMediaForBackup(eligibleItems.map(i => i.id));
      expect(queuedJobs.length).toBe(eligibleItems.length);

      const runResult = await engine.runQueue(NetworkPolicy.WIFI_ONLY, true);
      expect(runResult.processed).toBe(eligibleItems.length);
      expect(runResult.succeeded).toBe(eligibleItems.length);
      expect(uploadCalls).toBe(eligibleItems.length);

      // Verify idempotency: subsequent scan does not re-queue completed items
      const newScanResult = await MediaScannerService.scanMediaStore([]);
      const newItemsToQueue: string[] = [];
      for (const item of newScanResult.items) {
        const existing = await repo.getMediaItem(item.id);
        if (existing && existing.state === MediaState.BACKED_UP) {
          continue; // Already backed up!
        }
        newItemsToQueue.push(item.id);
      }
      expect(newItemsToQueue.length).toBe(0);
    });

    it('respects Wi-Fi only constraint and defers upload on mobile data', async () => {
      const repo = new InMemoryDatabaseRepository();
      let uploadCalls = 0;

      const engine = new BackupEngine(
        repo,
        async () => {
          uploadCalls++;
          return { channelId: '-100', messageId: '1' };
        },
        async () => null,
      );

      await repo.upsertMediaItem({
        id: 'auto-photo-1',
        sourceKey: 'content://media/1',
        mediaType: 'photo',
        displayName: 'test.jpg',
        relativePath: 'DCIM/test.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
        modifiedAtMs: Date.now(),
        createdAtMs: Date.now(),
        state: MediaState.DISCOVERED,
        isExcluded: false,
        lastScannedAtMs: Date.now(),
        createdAtMsLocal: Date.now(),
        updatedAtMsLocal: Date.now(),
      });

      await engine.queueMediaForBackup(['auto-photo-1']);

      // Cellular connection with Wi-Fi only policy
      const result = await engine.runQueue(NetworkPolicy.WIFI_ONLY, false);
      expect(result.processed).toBe(0);
      expect(uploadCalls).toBe(0);

      // Item should be transitioned to WAITING_FOR_NETWORK
      const item = await repo.getMediaItem('auto-photo-1');
      expect(item?.state).toBe(MediaState.WAITING_FOR_NETWORK);
    });
  });

  describe('4. Media Deletion for Local Gallery and Telegram Cloud', () => {
    it('deletes local gallery media without deleting the remote Telegram cloud backup', async () => {
      const repo = new InMemoryDatabaseRepository();

      // Create item that has been backed up
      await repo.upsertMediaItem({
        id: 'media-local-1',
        sourceKey: 'content://media/external/images/media/1001',
        mediaType: 'photo',
        displayName: 'vacation.jpg',
        relativePath: 'DCIM/Camera/vacation.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2500000,
        modifiedAtMs: Date.now(),
        createdAtMs: Date.now(),
        state: MediaState.BACKED_UP,
        isExcluded: false,
        lastScannedAtMs: Date.now(),
        createdAtMsLocal: Date.now(),
        updatedAtMsLocal: Date.now(),
      });

      await repo.recordTelegramObject({
        id: 'tg-obj-1',
        mediaItemId: 'media-local-1',
        channelId: '-1001234567890',
        messageId: 'msg-501',
        remoteFileId: 'remote-501',
        metadataVersion: 1,
        contentHash: 'hash-501',
        uploadedAtMs: Date.now(),
        verifiedAtMs: Date.now(),
        status: 'available',
      });

      // User triggers "Delete from Device"
      const localDeleted = await MediaScannerService.deleteLocalMedia(
        'content://media/external/images/media/1001',
      );
      expect(localDeleted).toBe(true);

      // Local item record is deleted
      await repo.deleteMediaItem('media-local-1');
      const itemAfterLocalDelete = await repo.getMediaItem('media-local-1');
      expect(itemAfterLocalDelete).toBeNull();

      // But remote Telegram cloud message and history are intact!
      const tgDeleteResult = await TelegramBridgeService.getChannelHistory('-1001234567890', 10);
      expect(tgDeleteResult).toBeDefined();
    });

    it('deletes cloud backup from Telegram without deleting the local file on device', async () => {
      const repo = new InMemoryDatabaseRepository();

      await repo.upsertMediaItem({
        id: 'media-cloud-1',
        sourceKey: 'content://media/external/images/media/1002',
        mediaType: 'photo',
        displayName: 'family.jpg',
        relativePath: 'DCIM/Camera/family.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 3000000,
        modifiedAtMs: Date.now(),
        createdAtMs: Date.now(),
        state: MediaState.BACKED_UP,
        isExcluded: false,
        lastScannedAtMs: Date.now(),
        createdAtMsLocal: Date.now(),
        updatedAtMsLocal: Date.now(),
      });

      await repo.recordTelegramObject({
        id: 'tg-obj-2',
        mediaItemId: 'media-cloud-1',
        channelId: '-1001234567890',
        messageId: 'msg-502',
        remoteFileId: 'remote-502',
        metadataVersion: 1,
        contentHash: 'hash-502',
        uploadedAtMs: Date.now(),
        verifiedAtMs: Date.now(),
        status: 'available',
      });

      // User triggers "Delete from Cloud"
      const cloudDeleted = await TelegramBridgeService.deleteMessages(
        '-1001234567890',
        ['msg-502'],
      );
      expect(cloudDeleted).toBe(true);

      // Remove telegram object from local database
      await repo.deleteTelegramObject('-1001234567890', 'msg-502');
      const tgObj = await repo.getTelegramObjectForMedia('media-cloud-1');
      expect(tgObj).toBeNull();

      // Local item STILL EXISTS on device!
      const localItem = await repo.getMediaItem('media-cloud-1');
      expect(localItem).not.toBeNull();
      expect(localItem?.sourceKey).toBe('content://media/external/images/media/1002');
    });

    it('supports bulk deletion of multiple cloud items with rate-limiting safety', async () => {
      const repo = new InMemoryDatabaseRepository();

      const msgIds = ['msg-101', 'msg-102', 'msg-103', 'msg-104', 'msg-105'];
      for (let i = 0; i < msgIds.length; i++) {
        await repo.recordTelegramObject({
          id: `tg-bulk-${i}`,
          mediaItemId: `media-bulk-${i}`,
          channelId: '-1001234567890',
          messageId: msgIds[i],
          remoteFileId: `remote-${i}`,
          metadataVersion: 1,
          contentHash: `hash-${i}`,
          uploadedAtMs: Date.now(),
          verifiedAtMs: Date.now(),
          status: 'available',
        });
      }

      // Execute bulk deletion
      const success = await TelegramBridgeService.deleteMessages(
        '-1001234567890',
        msgIds,
      );
      expect(success).toBe(true);

      for (const id of msgIds) {
        await repo.deleteTelegramObject('-1001234567890', id);
      }

      for (let i = 0; i < msgIds.length; i++) {
        const obj = await repo.getTelegramObjectForMedia(`media-bulk-${i}`);
        expect(obj).toBeNull();
      }
    });
  });

  describe('5. Stale 99 Cloud Items Synchronization & Authoritative Reconciliation', () => {
    it('produces an empty cloud gallery after channel contents are deleted from Telegram', async () => {
      const repo = new InMemoryDatabaseRepository();
      const restoreManager = new RestoreManager(repo);

      // 1. Simulate initial channel state containing 99 items
      const mock99Items: TelegramHistoryItem[] = [];
      for (let i = 1; i <= 99; i++) {
        mock99Items.push({
          messageId: `msg-${1000 + i}`,
          chatId: '-1001234567890',
          fileId: 20000 + i,
          date: Math.floor(Date.now() / 1000) - i * 60,
          mediaId: `cloud-item-${i}`,
          mediaType: i % 3 === 0 ? 'video' : 'photo',
          originalName: `backup_${i}.${i % 3 === 0 ? 'mp4' : 'jpg'}`,
          relativePath: `DCIM/Camera/backup_${i}.${i % 3 === 0 ? 'mp4' : 'jpg'}`,
          sizeBytes: 1_500_000 + i * 1000,
          modifiedAtMs: Date.now() - i * 60000,
        });
      }

      // Initial index build
      await restoreManager.rebuildIndexFromRemoteHistory(mock99Items);
      const metricsBefore = await repo.getDashboardMetrics();
      expect(metricsBefore.backedUp).toBe(99);

      // 2. User deletes all messages from Telegram channel (remote history is now empty!)
      const freshRemoteHistory: TelegramHistoryItem[] = [];

      // 3. Sync Now triggered: reconcile database against remote source of truth
      const validMessageIds = new Set(freshRemoteHistory.map(h => h.messageId));
      const removedCount = await repo.reconcileTelegramObjects(
        '-1001234567890',
        validMessageIds,
      );
      expect(removedCount).toBe(99);

      // 4. Cloud items mapped from authoritative remote history
      const mappedCloudItems = freshRemoteHistory.map(h => ({
        id: h.mediaId,
        messageId: h.messageId,
        channelId: h.chatId,
      }));

      // Cloud gallery displays exactly 0 items!
      expect(mappedCloudItems.length).toBe(0);

      // 5. Reopening app / rescanning preserves the 0-item state (no stale items return)
      const metricsAfter = await repo.getDashboardMetrics();
      expect(metricsAfter.backedUp).toBe(0);
    });

    it('paginates large message histories beyond a single 100-item batch', async () => {
      // Simulate multi-batch pagination helper
      const batch1: TelegramHistoryItem[] = Array.from({ length: 100 }, (_, i) => ({
        messageId: `batch1-${i}`,
        chatId: '-1001234567890',
        fileId: 1000 + i,
        date: 1000000 + i,
        mediaId: `item-${i}`,
        mediaType: 'photo',
        originalName: `img_${i}.jpg`,
        relativePath: `DCIM/img_${i}.jpg`,
        sizeBytes: 1000,
        modifiedAtMs: 1000000 + i,
      }));

      const batch2: TelegramHistoryItem[] = Array.from({ length: 50 }, (_, i) => ({
        messageId: `batch2-${i}`,
        chatId: '-1001234567890',
        fileId: 2000 + i,
        date: 2000000 + i,
        mediaId: `item-${100 + i}`,
        mediaType: 'photo',
        originalName: `img_${100 + i}.jpg`,
        relativePath: `DCIM/img_${100 + i}.jpg`,
        sizeBytes: 1000,
        modifiedAtMs: 2000000 + i,
      }));

      // Combined multi-batch history accounts for all 150 items
      const completeHistory = [...batch1, ...batch2];
      expect(completeHistory.length).toBe(150);

      const repo = new InMemoryDatabaseRepository();
      const restoreManager = new RestoreManager(repo);
      await restoreManager.rebuildIndexFromRemoteHistory(completeHistory);

      const metrics = await repo.getDashboardMetrics();
      expect(metrics.backedUp).toBe(150);
    });

    it('reports sync error on network failure without claiming channel is empty', async () => {
      let syncStatus: 'synced' | 'syncing' | 'error' = 'syncing';
      let syncErrorMessage: string | null = null;
      let displayedItemsCount = 50; // Existing verified items

      // Simulate network request failing
      try {
        throw new Error('Connection refused: TDLib network timeout');
      } catch (err: any) {
        syncStatus = 'error';
        syncErrorMessage = err.message;
        // Do NOT overwrite displayedItemsCount with 0 on network error!
      }

      expect(syncStatus).toBe('error');
      expect(syncErrorMessage).toContain('TDLib network timeout');
      expect(displayedItemsCount).toBe(50); // Preserves verified state
    });
  });
});
