import { InMemoryDatabaseRepository } from '../src/domain/database/repository';
import { RestoreManager } from '../src/domain/restore/restoreManager';
import {
  initializeEncryptionSetup,
  encryptMediaPayload,
  verifyPassphraseAgainstItem,
  SessionKeyStore,
  createEncryptedCaptionEnvelope,
} from '../src/domain/crypto/encryptionService';
import { TelegramHistoryItem } from '../src/types/telegram';
import { MediaState, NetworkPolicy } from '../src/domain/backup/stateMachine';
import { BackupEngine } from '../src/domain/backup/engine';

describe('Cloud Discovery, Encryption Recovery Lifecycle & Queue Control', () => {
  let repo: InMemoryDatabaseRepository;
  let restoreManager: RestoreManager;

  beforeEach(() => {
    repo = new InMemoryDatabaseRepository();
    restoreManager = new RestoreManager(repo);
    SessionKeyStore.clear();
  });

  afterEach(() => {
    SessionKeyStore.clear();
  });

  describe('Encryption Setup, Logout & Data Clear Recovery Lifecycle', () => {
    it('discovers encrypted cloud media records before recovery key is entered (separation of discovery from decryption)', async () => {
      // 1. User sets up encryption and encrypts a media item
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      const plainBuffer = Buffer.from('photo-bytes-content-12345', 'utf8');
      const sensitiveMeta = {
        originalName: 'FamilyVacation.jpg',
        relativePath: 'DCIM/Camera/FamilyVacation.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048000,
        modifiedAtMs: 1792600000000,
        contentHash: 'content-hash-vacation',
      };

      const encResult = encryptMediaPayload(
        plainBuffer,
        sensitiveMeta,
        masterKey,
        setup.config.kdfSalt,
      );

      // Create privacy-preserving Telegram envelope
      const captionEnvelope = createEncryptedCaptionEnvelope(
        'media-vacation-1',
        'photo',
        encResult.encryptedMedia.length,
        encResult.envelope,
      );

      // 2. Simulate app data deletion / re-login:
      // A fresh database has NO local keys and NO knowledge of master key
      const remoteHistoryItem: TelegramHistoryItem = {
        messageId: '1001',
        chatId: '-100999001',
        fileId: 444,
        mediaId: captionEnvelope.mediaId,
        mediaType: captionEnvelope.mediaType,
        originalName: captionEnvelope.originalName, // 'encrypted.bin'
        relativePath: captionEnvelope.relativePath,
        sizeBytes: captionEnvelope.sizeBytes,
        modifiedAtMs: captionEnvelope.modifiedAtMs,
        date: 1792600000,
        encryptionEnvelope: encResult.envelope,
      };

      // 3. Rebuild index WITHOUT master key
      const rebuildResult = await restoreManager.rebuildIndexFromRemoteHistory([remoteHistoryItem]);
      expect(rebuildResult.indexedCount).toBe(1);

      // 4. Verify item exists in database and is marked locked (never empty gallery!)
      const discovered = await repo.getMediaItem('media-vacation-1');
      expect(discovered).toBeDefined();
      expect(discovered?.displayName).toBe('Encrypted Item (Locked)');
      expect(discovered?.state).toBe(MediaState.BACKED_UP);
    });

    it('rejects an incorrect recovery passphrase with authenticated decryption error', () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      const encResult = encryptMediaPayload(
        Buffer.from('sample', 'utf8'),
        {
          originalName: 'Secret.jpg',
          relativePath: 'DCIM/Secret.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1000,
          modifiedAtMs: 1792600000000,
        },
        masterKey,
        setup.config.kdfSalt,
      );

      // Attempt verification with an incorrect passphrase
      const wrongPassphrase =
        'alpha delta canyon beacon eagle forest galaxy harbor island jungle kinetic ocean';

      const verifyWrong = verifyPassphraseAgainstItem(wrongPassphrase, encResult.envelope);
      expect(verifyWrong.valid).toBe(false);
      expect(verifyWrong.errorMessage).toBeDefined();
    });

    it('accepts correct recovery passphrase, unlocks session key and decrypts cloud metadata', async () => {
      // 1. Setup and encryption
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      const sensitiveMeta = {
        originalName: 'ConfidentialDoc.jpg',
        relativePath: 'Documents/ConfidentialDoc.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 512000,
        modifiedAtMs: 1792600000000,
        contentHash: 'hash-confidential',
      };

      const encResult = encryptMediaPayload(
        Buffer.from('doc-content', 'utf8'),
        sensitiveMeta,
        masterKey,
        setup.config.kdfSalt,
      );

      const remoteItem: TelegramHistoryItem = {
        messageId: '1002',
        chatId: '-100999001',
        fileId: 445,
        mediaId: 'media-doc-1',
        mediaType: 'photo',
        originalName: 'encrypted.bin',
        relativePath: '',
        sizeBytes: 512000,
        modifiedAtMs: 1792600000000,
        date: 1792600000,
        encryptionEnvelope: encResult.envelope,
      };

      // 2. Discover in locked state first
      await restoreManager.rebuildIndexFromRemoteHistory([remoteItem]);
      const initialItem = await repo.getMediaItem('media-doc-1');
      expect(initialItem?.displayName).toBe('Encrypted Item (Locked)');

      // 3. Enter and verify correct passphrase
      const verifySuccess = verifyPassphraseAgainstItem(setup.recoveryKey, encResult.envelope);
      expect(verifySuccess.valid).toBe(true);
      expect(verifySuccess.masterKey).toBeDefined();

      // Store in memory session store (never to disk)
      SessionKeyStore.setSessionKey(verifySuccess.masterKey!, setup.recoveryKey);
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      // 4. Decrypt metadata for locked media
      const unlockedCount = await restoreManager.unlockEncryptedMedia(
        [remoteItem],
        verifySuccess.masterKey!,
      );
      expect(unlockedCount).toBe(1);

      // 5. Verify local database now reflects decrypted metadata
      const decryptedItem = await repo.getMediaItem('media-doc-1');
      expect(decryptedItem?.displayName).toBe('ConfidentialDoc.jpg');
      expect(decryptedItem?.relativePath).toBe('Documents/ConfidentialDoc.jpg');
      expect(decryptedItem?.contentHash).toBe('hash-confidential');

      // 6. Test lock again: clears in-memory secret
      SessionKeyStore.clear();
      expect(SessionKeyStore.isUnlocked()).toBe(false);
      expect(SessionKeyStore.getSessionKey()).toBeNull();
    });
  });

  describe('Persistent Upload Queue, Backpressure and Queue Controls', () => {
    it('supports cancelling pending jobs without corrupting database state', async () => {
      const mockUploader = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ channelId: '-1001', messageId: '1' }), 50)),
      );
      const engine = new BackupEngine(repo, mockUploader, async () => null);

      await repo.upsertMediaItem({
        id: 'item-cancel-1',
        mediaType: 'photo',
        displayName: 'Photo1.jpg',
        sizeBytes: 1000,
        modifiedAtMs: Date.now(),
        createdAtMs: Date.now(),
        state: MediaState.DISCOVERED,
        isExcluded: false,
        lastScannedAtMs: Date.now(),
        createdAtMsLocal: Date.now(),
        updatedAtMsLocal: Date.now(),
      });

      await engine.queueMediaForBackup(['item-cancel-1']);

      const statsBefore = await engine.getQueueStats();
      expect(statsBefore.pending).toBe(1);

      // Cancel all pending jobs
      const cancelledCount = await engine.cancelAll();
      expect(cancelledCount).toBe(1);

      const statsAfter = await engine.getQueueStats();
      expect(statsAfter.pending).toBe(0);

      const item = await repo.getMediaItem('item-cancel-1');
      expect(item?.state).toBe(MediaState.DISCOVERED);
    });

    it('supports retrying failed jobs with exponential backoff reset', async () => {
      const mockUploader = jest.fn().mockRejectedValue(new Error('Network connection timeout'));
      const engine = new BackupEngine(repo, mockUploader, async () => null);

      await repo.upsertMediaItem({
        id: 'item-retry-1',
        mediaType: 'photo',
        displayName: 'PhotoRetry.jpg',
        sizeBytes: 1000,
        modifiedAtMs: Date.now(),
        createdAtMs: Date.now(),
        state: MediaState.DISCOVERED,
        isExcluded: false,
        lastScannedAtMs: Date.now(),
        createdAtMsLocal: Date.now(),
        updatedAtMsLocal: Date.now(),
      });

      await engine.queueMediaForBackup(['item-retry-1']);
      await engine.runQueue(NetworkPolicy.WIFI_ONLY, true);

      const statsFailed = await engine.getQueueStats();
      expect(statsFailed.failed).toBe(1);

      // Retry failed jobs
      const retriedCount = await engine.retryFailed();
      expect(retriedCount).toBe(1);

      const statsRetried = await engine.getQueueStats();
      expect(statsRetried.pending).toBe(1);
      expect(statsRetried.failed).toBe(0);
    });
  });
});
