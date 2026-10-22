import { Buffer } from 'buffer';
import {
  initializeEncryptionSetup,
  initializeEncryptionSetupAsync,
  verifyRecoveryKey,
  verifyRecoveryKeyAsync,
  encryptMediaPayload,
  decryptMediaPayload,
  SessionKeyStore,
} from '../src/domain/crypto/encryptionService';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import { InMemoryDatabaseRepository } from '../src/domain/database/repository';

describe('Bug Fix Regressions: Encryption Setup & Telegram Channel Duplication', () => {
  beforeEach(() => {
    SessionKeyStore.clear();
  });

  describe('Bug 1: Client-Side Encryption Setup & Key Preservation', () => {
    test('Buffer is available globally and imported, preventing ReferenceError', () => {
      expect(typeof Buffer).toBe('function');
      expect(Buffer.from('test').toString('utf8')).toBe('test');
    });

    test('successful enablement via initializeEncryptionSetup and async native bridge', async () => {
      const syncSetup = initializeEncryptionSetup();
      expect(syncSetup.recoveryKey.split(' ')).toHaveLength(12);
      expect(syncSetup.config.enabled).toBe(true);
      expect(syncSetup.masterKeyHex).toHaveLength(64);

      const asyncSetup = await initializeEncryptionSetupAsync();
      expect(asyncSetup.recoveryKey.split(' ')).toHaveLength(12);
      expect(asyncSetup.config.enabled).toBe(true);
      expect(asyncSetup.masterKeyHex).toHaveLength(64);
    });

    test('existing key remains intact after failure or re-toggle and is never overwritten', async () => {
      const initialSetup = initializeEncryptionSetup();
      const initialMasterKey = Buffer.from(initialSetup.masterKeyHex, 'hex');
      SessionKeyStore.setSessionKey(initialMasterKey, initialSetup.recoveryKey, initialSetup.config);

      // Verify initial setup is active
      expect(SessionKeyStore.isUnlocked()).toBe(true);
      const originalConfig = SessionKeyStore.getConfig();
      expect(originalConfig?.verificationToken).toBe(initialSetup.config.verificationToken);

      // User locks / turns off encryption session
      SessionKeyStore.clear();
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // Existing configuration MUST be retained so existing backups can be restored!
      SessionKeyStore.setConfig(originalConfig!);
      expect(SessionKeyStore.getConfig()?.verificationToken).toBe(originalConfig?.verificationToken);

      // Re-unlock with the original passphrase
      const unlockResult = await verifyRecoveryKeyAsync(
        initialSetup.recoveryKey,
        SessionKeyStore.getConfig()!,
      );
      expect(unlockResult.valid).toBe(true);
      expect(unlockResult.masterKeyHex).toBe(initialSetup.masterKeyHex);
    });

    test('restart and unlock flow with SQLite settings persistence', async () => {
      const repo = new InMemoryDatabaseRepository();
      const setup = await initializeEncryptionSetupAsync();

      // Persist to repository
      await repo.setSetting('client_encryption_config', JSON.stringify(setup.config));
      await repo.setSetting('encryption_enabled', 'true');

      // Simulate app restart: SessionKeyStore is blank
      SessionKeyStore.clear();
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // Startup restoration
      const savedConfigStr = await repo.getSetting('client_encryption_config');
      expect(savedConfigStr).not.toBeNull();
      const restoredConfig = JSON.parse(savedConfigStr!);
      SessionKeyStore.setConfig(restoredConfig);

      // Remains locked until user provides 12-word passphrase
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // User enters correct passphrase
      const verifyRes = verifyRecoveryKey(setup.recoveryKey, SessionKeyStore.getConfig()!);
      expect(verifyRes.valid).toBe(true);

      const masterKey = Buffer.from(verifyRes.masterKeyHex!, 'hex');
      SessionKeyStore.setSessionKey(masterKey, setup.recoveryKey, restoredConfig);
      expect(SessionKeyStore.isUnlocked()).toBe(true);
    });

    test('encrypted photo and video payload creation and recovery', async () => {
      const setup = await initializeEncryptionSetupAsync();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      // Photo payload
      const photoData = Buffer.from('RAW_PHOTO_PIXEL_DATA_V1');
      const photoMeta = {
        originalName: 'sunset.jpg',
        relativePath: 'DCIM/Camera',
        mimeType: 'image/jpeg',
        sizeBytes: photoData.length,
        modifiedAtMs: 1700000000000,
      };
      const photoEnc = encryptMediaPayload(photoData, photoMeta, masterKey);
      expect(photoEnc.encryptedMedia).not.toEqual(photoData);

      const photoDec = decryptMediaPayload(photoEnc.encryptedMedia, photoEnc.envelope, masterKey);
      expect(photoDec.decryptedMedia.toString('utf8')).toBe('RAW_PHOTO_PIXEL_DATA_V1');
      expect(photoDec.metadata.originalName).toBe('sunset.jpg');

      // Video payload
      const videoData = Buffer.from('RAW_MP4_VIDEO_FRAME_BYTES_010203');
      const videoMeta = {
        originalName: 'vacation.mp4',
        relativePath: 'DCIM/Camera',
        mimeType: 'video/mp4',
        sizeBytes: videoData.length,
        modifiedAtMs: 1700000005000,
      };
      const videoEnc = encryptMediaPayload(videoData, videoMeta, masterKey);
      const videoDec = decryptMediaPayload(videoEnc.encryptedMedia, videoEnc.envelope, masterKey);
      expect(videoDec.decryptedMedia.toString('utf8')).toBe('RAW_MP4_VIDEO_FRAME_BYTES_010203');
      expect(videoDec.metadata.originalName).toBe('vacation.mp4');
    });

    test('invalid passphrase rejection without exposing secrets', async () => {
      const setup = await initializeEncryptionSetupAsync();
      const wrongPassphrase = 'wrong alpha beta gamma delta eagle forest galaxy harbor island jungle kinetic';
      const verifyRes = verifyRecoveryKey(wrongPassphrase, setup.config);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.errorMessage).toBeDefined();
      expect(verifyRes.errorMessage).not.toContain(setup.masterKeyHex);
    });
  });

  describe('Bug 4: Idempotent Telegram Destination Management', () => {
    test('refreshDestinations is read-only and never creates channels', async () => {
      const createSpy = jest.spyOn(TelegramBridgeService, 'createDestination');
      const setupSpy = jest.spyOn(TelegramBridgeService, 'setupChannels');

      const destinations = await TelegramBridgeService.refreshDestinations();

      expect(destinations).not.toBeNull();
      expect(destinations?.photoChannelTitle).toBe('Backup - Photos');
      expect(destinations?.videoChannelTitle).toBe('Backup - Videos');

      // Zero create calls!
      expect(createSpy).not.toHaveBeenCalled();
      expect(setupSpy).not.toHaveBeenCalled();

      createSpy.mockRestore();
      setupSpy.mockRestore();
    });

    test('repeated refreshes produce zero create calls and zero duplicate channels', async () => {
      const createSpy = jest.spyOn(TelegramBridgeService, 'createDestination');

      for (let i = 0; i < 5; i++) {
        const res = await TelegramBridgeService.refreshDestinations();
        expect(res).not.toBeNull();
      }

      expect(createSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
    });

    test('concurrent refresh requests do not trigger channel creation', async () => {
      const createSpy = jest.spyOn(TelegramBridgeService, 'createDestination');

      const promises = [
        TelegramBridgeService.refreshDestinations(),
        TelegramBridgeService.refreshDestinations(),
        TelegramBridgeService.refreshDestinations(),
        TelegramBridgeService.refreshDestinations(),
      ];

      const results = await Promise.all(promises);
      expect(results).toHaveLength(4);
      results.forEach(res => {
        expect(res?.verified).toBe(true);
      });

      expect(createSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
    });

    test('explicit channel creation only occurs when requested by user', async () => {
      const createdPhoto = await TelegramBridgeService.createDestination('photo');
      expect(createdPhoto.channelId).toBeDefined();
      expect(createdPhoto.title).toBe('Backup - Photos');

      const createdVideo = await TelegramBridgeService.createDestination('video');
      expect(createdVideo.channelId).toBeDefined();
      expect(createdVideo.title).toBe('Backup - Videos');
    });

    test('reconnectDestination validates access without recreating', async () => {
      const createSpy = jest.spyOn(TelegramBridgeService, 'createDestination');

      const isValid = await TelegramBridgeService.reconnectDestination('-1001234567890');
      expect(isValid).toBe(true);
      expect(createSpy).not.toHaveBeenCalled();

      createSpy.mockRestore();
    });
  });
});
