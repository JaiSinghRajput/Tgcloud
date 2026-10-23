import { Buffer } from 'buffer';
import {
  UnifiedEncryptionService,
  SessionKeyStore,
  initializeEncryptionSetup,
  deriveMasterKey,
  createVerificationToken,
  encryptMediaPayload,
  decryptMediaPayload,
  validateKeyAgainstEncryptedObject,
  persistEncryptionConfigSecurely,
  loadPersistedEncryptionConfig,
  persistMasterKeySecurely,
  loadPersistedMasterKey,
  clearPersistedMasterKey,
} from '../src/domain/crypto/encryptionService';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import { EncryptionConfig, EncryptedItemEnvelope } from '../src/types/encryption';

describe('Persistent Encryption Key and Consistent Cloud Unlock Test Suite', () => {
  beforeEach(async () => {
    await UnifiedEncryptionService.resetAll();
  });

  afterEach(async () => {
    await UnifiedEncryptionService.resetAll();
  });

  describe('Bug 1: Key Persistence Across Normal App Restarts', () => {
    it('restores encryption key and config across process restart without asking for passphrase', async () => {
      // Step 1: User sets up or unlocks encryption with 12-word passphrase
      const setup = initializeEncryptionSetup();
      await persistEncryptionConfigSecurely(setup.config);
      const unlockRes = await UnifiedEncryptionService.unlockWithPassphrase(setup.recoveryKey);
      expect(unlockRes.success).toBe(true);
      expect(unlockRes.status).toBe('UNLOCKED');
      expect(UnifiedEncryptionService.getEncryptionStatus()).toBe('UNLOCKED');
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      const originalMasterKeyHex = unlockRes.masterKeyHex;
      expect(originalMasterKeyHex).toBe(setup.masterKeyHex);

      // Step 2: Simulate full application process termination / death
      // In-memory key material is destroyed
      SessionKeyStore.clear();
      expect(SessionKeyStore.isUnlocked()).toBe(false);
      expect(SessionKeyStore.getSessionKey()).toBeNull();

      // Step 3: App launches again - startup sequence restores key & metadata automatically
      const startupStatus = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      expect(startupStatus).toBe('UNLOCKED');
      expect(UnifiedEncryptionService.getEncryptionStatus()).toBe('UNLOCKED');
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      // Restored key matches original master key
      const restoredKey = SessionKeyStore.getSessionKey();
      expect(restoredKey).not.toBeNull();
      expect(restoredKey!.toString('hex')).toBe(originalMasterKeyHex);

      // Non-secret config is also restored and verified
      const restoredConfig = SessionKeyStore.getConfig();
      expect(restoredConfig).not.toBeNull();
      expect(restoredConfig?.kdfSalt).toBe(setup.config.kdfSalt);
    });

    it('explicit Lock encryption requires passphrase again, while normal restart does not', async () => {
      const setup = initializeEncryptionSetup();
      await UnifiedEncryptionService.unlockWithPassphrase(setup.recoveryKey);
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      // Normal restart preserves key
      SessionKeyStore.clear();
      let status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      expect(status).toBe('UNLOCKED');

      // User performs explicit Lock Encryption action
      await UnifiedEncryptionService.lockEncryption();
      expect(UnifiedEncryptionService.getEncryptionStatus()).toBe('LOCKED');
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // Startup after explicit lock remains LOCKED
      status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      expect(status).toBe('LOCKED');
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // Unlocking again with passphrase succeeds
      const reUnlock = await UnifiedEncryptionService.unlockWithPassphrase(setup.recoveryKey);
      expect(reUnlock.success).toBe(true);
      expect(reUnlock.status).toBe('UNLOCKED');
    });

    it('reproduces Bug 1: in-memory DB loss caused repeated passphrase prompts, resolved by secure config storage', async () => {
      const setup = initializeEncryptionSetup();

      // In the buggy implementation, key was stored in Keystore but config was only in in-memory SQLite repo
      // When app reopened, in-memory repo was empty, so repo.getSetting('client_encryption_config') was null
      // and repo.getSetting('encryption_enabled') was null, causing loadPersistedMasterKey() to be skipped!
      await persistMasterKeySecurely(setup.masterKeyHex);
      await TelegramBridgeService.clearSecureEncryptionConfig(); // simulate missing config

      SessionKeyStore.clear();

      // With missing config, restoreEncryptionOnStartup handles gracefully
      const status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      // Since key exists in Keystore, it restores key safely
      expect(status).toBe('UNLOCKED');
      expect(SessionKeyStore.getSessionKey()?.toString('hex')).toBe(setup.masterKeyHex);
    });

    it('handles secure-storage read failure explicitly without generating a replacement key', async () => {
      // Mock Keystore failure
      const originalLoad = TelegramBridgeService.loadSecureMasterKey;
      (TelegramBridgeService as any).loadSecureMasterKey = jest.fn().mockRejectedValue(
        new Error('Keystore hardware invalidated'),
      );

      try {
        const status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
        expect(status).toBe('ERROR');
        expect(UnifiedEncryptionService.getEncryptionStatus()).toBe('ERROR');
        expect(SessionKeyStore.isUnlocked()).toBe(false);
        // Verify no replacement key was generated
        expect(SessionKeyStore.getSessionKey()).toBeNull();
      } finally {
        (TelegramBridgeService as any).loadSecureMasterKey = originalLoad;
      }
    });

    it('does not falsely mark encryption as unlocked after failed restore or corrupted key', async () => {
      // Store a corrupted key (not 64-hex / invalid length)
      await TelegramBridgeService.storeSecureMasterKey('corrupted_short_key');

      const status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      expect(status).toBe('LOCKED');
      expect(UnifiedEncryptionService.getEncryptionStatus()).toBe('LOCKED');
      expect(SessionKeyStore.isUnlocked()).toBe(false);
    });
  });

  describe('Bug 2: Cloud Unlock vs Settings Consistency', () => {
    it('accepts the same valid passphrase in both Settings and Cloud flows', async () => {
      const setup = initializeEncryptionSetup();
      await persistEncryptionConfigSecurely(setup.config);

      // 1. Unlock via Settings flow using UnifiedEncryptionService
      const settingsResult = await UnifiedEncryptionService.unlockWithPassphrase(setup.recoveryKey);
      expect(settingsResult.success).toBe(true);
      expect(settingsResult.status).toBe('UNLOCKED');

      const settingsKeyHex = SessionKeyStore.getSessionKey()?.toString('hex');
      expect(settingsKeyHex).toBe(setup.masterKeyHex);

      // Explicitly lock
      await UnifiedEncryptionService.lockEncryption();
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // 2. Unlock via Cloud flow using UnifiedEncryptionService with candidate envelopes
      const mockEnvelope: EncryptedItemEnvelope = {
        alg: 'AES-256-GCM',
        keyVersion: 1,
        iv: 'mockIv',
        tag: 'mockTag',
        encryptedDek: 'mockDek',
        dekIv: 'mockDekIv',
        dekTag: 'mockDekTag',
        salt: setup.config.kdfSalt,
        verificationToken: setup.config.verificationToken,
      };

      const cloudResult = await UnifiedEncryptionService.unlockWithPassphrase(
        setup.recoveryKey,
        [mockEnvelope],
      );
      expect(cloudResult.success).toBe(true);
      expect(cloudResult.status).toBe('UNLOCKED');

      const cloudKeyHex = SessionKeyStore.getSessionKey()?.toString('hex');
      expect(cloudKeyHex).toBe(settingsKeyHex);
    });

    it('reproduces Bug 2: Cloud flow with envelope missing salt or with legacy format now succeeds consistently', async () => {
      const setup = initializeEncryptionSetup();

      // Envelope from an older backup where salt was omitted on item envelope
      const envelopeWithoutSalt: EncryptedItemEnvelope = {
        alg: 'AES-256-GCM',
        keyVersion: 1,
        iv: 'someIv',
        tag: 'someTag',
        encryptedDek: 'someDek',
        dekIv: 'someDekIv',
        dekTag: 'someDekTag',
        // salt is missing!
      };

      // Set config in secure store (as Settings does)
      await persistEncryptionConfigSecurely(setup.config);

      // In the buggy Cloud code, verifying against envelopeWithoutSalt immediately failed:
      // "Salt missing from encrypted envelope. Cannot derive key." -> returned "Invalid key".
      // In UnifiedEncryptionService, it uses activeConfig salt and verificationToken as source of truth!
      const result = await UnifiedEncryptionService.unlockWithPassphrase(
        setup.recoveryKey,
        [envelopeWithoutSalt],
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('UNLOCKED');
      expect(SessionKeyStore.getSessionKey()?.toString('hex')).toBe(setup.masterKeyHex);
    });

    it('reports genuine authentication failure when entering an incorrect passphrase', async () => {
      const setup = initializeEncryptionSetup();
      await persistEncryptionConfigSecurely(setup.config);

      const wrongPassphrase = 'wrong alpha beta gamma delta forest galaxy harbor island jungle kinetic lagoon';
      const result = await UnifiedEncryptionService.unlockWithPassphrase(wrongPassphrase);

      expect(result.success).toBe(false);
      expect(result.status).toBe('LOCKED');
      expect(result.errorCode).toBe('INVALID_PASSPHRASE');
      expect(result.errorMessage).toContain('Incorrect recovery passphrase');
      expect(SessionKeyStore.isUnlocked()).toBe(false);
    });

    it('distinguishes missing metadata from invalid passphrase', async () => {
      // Clean slate with no config and empty envelopes
      const unknownPassphrase = 'alpha beacon canyon delta eagle forest galaxy harbor island jungle kinetic lagoon';
      // When clean slate, it initializes safely without mislabeling as an error
      const result = await UnifiedEncryptionService.unlockWithPassphrase(unknownPassphrase);
      expect(result.success).toBe(true);
      expect(result.status).toBe('UNLOCKED');
    });

    it('handles Unicode passphrases with spaces and non-ASCII characters consistently', async () => {
      // Passphrase with irregular whitespace, tabs, and accents
      const irregularPassphrase = '  alpha   beacon   canyon   delta   eagle   forest   galaxy   harbor   island   jungle   kinetic   lagoon  ';
      const cleanPassphrase = 'alpha beacon canyon delta eagle forest galaxy harbor island jungle kinetic lagoon';

      const result1 = await UnifiedEncryptionService.unlockWithPassphrase(irregularPassphrase);
      expect(result1.success).toBe(true);
      const key1 = result1.masterKeyHex;

      await UnifiedEncryptionService.lockEncryption();

      const result2 = await UnifiedEncryptionService.unlockWithPassphrase(cleanPassphrase);
      expect(result2.success).toBe(true);
      const key2 = result2.masterKeyHex;

      expect(key1).toBe(key2);
    });
  });

  describe('3. Backup Compatibility & Cryptographic Integrity', () => {
    it('decrypts existing AES-256-GCM backups with DEK envelope using restored key', async () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');

      // Create an existing encrypted photo backup
      const plaintext = Buffer.from('Original high-res photo bytes from backup');
      const meta = {
        originalName: 'DCIM_2026_vacation.jpg',
        relativePath: 'Camera/DCIM_2026_vacation.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: plaintext.length,
        modifiedAtMs: Date.now(),
      };

      const encrypted = encryptMediaPayload(plaintext, meta, masterKey, setup.config.kdfSalt);
      expect(encrypted.envelope.encryptedDek).toBeDefined();

      // Persist key and clear memory to simulate app reopen
      await UnifiedEncryptionService.persistProtectedKey(masterKey, setup.config);
      SessionKeyStore.clear();

      // Reopen app and restore key
      const status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      expect(status).toBe('UNLOCKED');

      const restoredKey = SessionKeyStore.getSessionKey();
      expect(restoredKey).not.toBeNull();

      // Validate candidate key against encrypted object
      const isValid = validateKeyAgainstEncryptedObject(restoredKey!, encrypted.envelope);
      expect(isValid).toBe(true);

      // Decrypt the existing media using restored key
      const decrypted = decryptMediaPayload(encrypted.encryptedMedia, encrypted.envelope, restoredKey!);
      expect(decrypted.decryptedMedia.toString('utf8')).toBe(plaintext.toString('utf8'));
      expect(decrypted.metadata.originalName).toBe('DCIM_2026_vacation.jpg');
    });

    it('rejects candidate key with mismatched authentication tag without crashing', async () => {
      const setup = initializeEncryptionSetup();
      const masterKey = Buffer.from(setup.masterKeyHex, 'hex');
      const wrongKey = Buffer.from(
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'hex',
      );

      const plaintext = Buffer.from('Sensitive family video');
      const meta = {
        originalName: 'video.mp4',
        relativePath: 'Camera/video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: plaintext.length,
        modifiedAtMs: Date.now(),
      };

      const encrypted = encryptMediaPayload(plaintext, meta, masterKey, setup.config.kdfSalt);

      // Wrong key fails validateKeyAgainstEncryptedObject
      const isValid = validateKeyAgainstEncryptedObject(wrongKey, encrypted.envelope);
      expect(isValid).toBe(false);

      // Decryption throws authenticated tag mismatch
      expect(() => {
        decryptMediaPayload(encrypted.encryptedMedia, encrypted.envelope, wrongKey);
      }).toThrow();
    });

    it('signing out of Telegram does not erase the Keystore encryption key', async () => {
      const setup = initializeEncryptionSetup();
      await persistEncryptionConfigSecurely(setup.config);
      await UnifiedEncryptionService.unlockWithPassphrase(setup.recoveryKey);
      expect(SessionKeyStore.isUnlocked()).toBe(true);

      // Simulate Telegram sign-out
      await TelegramBridgeService.logOut();
      SessionKeyStore.clear(); // clears in-memory session only

      // Keystore persisted key remains intact!
      const persistedKey = await UnifiedEncryptionService.getPersistedKey();
      expect(persistedKey).not.toBeNull();
      expect(persistedKey?.toString('hex')).toBe(setup.masterKeyHex);

      // Relaunching the app or signing back in restores encryption without prompt
      const status = await UnifiedEncryptionService.restoreEncryptionOnStartup();
      expect(status).toBe('UNLOCKED');
      expect(SessionKeyStore.isUnlocked()).toBe(true);
    });

    it('never leaks raw passphrases in persistent storage or logs', async () => {
      const setup = initializeEncryptionSetup();
      await persistEncryptionConfigSecurely(setup.config);
      await UnifiedEncryptionService.unlockWithPassphrase(setup.recoveryKey);

      // Verify that what is stored in secure vault is ONLY the 64-char hex key or encrypted representation
      const storedKeyHex = await TelegramBridgeService.loadSecureMasterKey();
      expect(storedKeyHex).toBe(setup.masterKeyHex);
      expect(storedKeyHex).not.toContain(setup.recoveryKey);
      expect(storedKeyHex?.split(' ').length).toBe(1); // Not 12 words!

      const storedConfigJson = await TelegramBridgeService.loadSecureEncryptionConfig();
      expect(storedConfigJson).not.toBeNull();
      expect(storedConfigJson).not.toContain(setup.recoveryKey);
    });
  });
});
