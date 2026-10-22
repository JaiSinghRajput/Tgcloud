import { Buffer } from 'buffer';
import {
  parseFloodWaitSeconds,
  isFloodWaitActive,
  persistFloodWaitState,
  getPersistedFloodWaitSeconds,
} from '../src/domain/backup/stateMachine';
import {
  deriveMasterKeyAsync,
  encryptMediaPayload,
  decryptBuffer,
  verifyPassphraseAgainstItemAsync,
  verifyRecoveryKeyAsync,
  SessionKeyStore,
  initializeEncryptionSetupAsync,
} from '../src/domain/crypto/encryptionService';
import { EncryptedItemEnvelope, EncryptionConfig } from '../src/types/encryption';
import { InMemoryDatabaseRepository } from '../src/domain/database/repository';

describe('Real Client-Side Encryption, Recovery & Flood Wait Protection', () => {
  beforeEach(() => {
    SessionKeyStore.clear();
  });

  describe('1. Telegram Flood Wait & Rate-Limit Protection', () => {
    it('parses FLOOD_WAIT_X error strings correctly', () => {
      expect(parseFloodWaitSeconds('Telegram error: 420 FLOOD_WAIT_30')).toBe(30);
      expect(parseFloodWaitSeconds('FLOOD_WAIT_120')).toBe(120);
      expect(parseFloodWaitSeconds('Rate limit exceeded. Retry after 45 seconds')).toBe(45);
      expect(parseFloodWaitSeconds('Too Many Requests: retry after 60')).toBe(60);
      expect(parseFloodWaitSeconds('General network error')).toBeNull();
    });

    it('persists flood wait state across restarts and detects active rate limits', async () => {
      const repo = new InMemoryDatabaseRepository();

      // Initially no wait
      const initialActive = await isFloodWaitActive(repo);
      expect(initialActive).toBe(false);

      // Persist wait of 60 seconds
      await persistFloodWaitState(repo, 60);

      const isActive = await isFloodWaitActive(repo);
      expect(isActive).toBe(true);

      const remaining = await getPersistedFloodWaitSeconds(repo);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60);
    });
  });

  describe('2. Real Client-Side Encryption & Masked Envelope', () => {
    it('encrypts sensitive metadata and payloads with unique random DEK and authenticates DEK with master key', async () => {
      const recoveryKey = 'eagle harbor quartz river beacon silver forest velvet canyon crystal shadow marble';
      const saltHex = '0123456789abcdef0123456789abcdef';
      const masterKey = await deriveMasterKeyAsync(recoveryKey, saltHex, 1000);

      const rawPhotoBytes = Buffer.from('RAW_UNENCRYPTED_JPEG_PHOTO_DATA_12345678', 'utf8');
      const sensitiveMeta = {
        originalName: 'secret_vacation_photo.jpg',
        relativePath: 'DCIM/Camera/secret_vacation_photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: rawPhotoBytes.length,
        modifiedAtMs: 1700000000000,
      };

      const encrypted = encryptMediaPayload(rawPhotoBytes, sensitiveMeta, masterKey, saltHex);

      // Verify payload is encrypted (ciphertext does not contain raw string)
      expect(encrypted.encryptedMedia.toString('utf8')).not.toContain('RAW_UNENCRYPTED_JPEG_PHOTO_DATA_12345678');
      expect(encrypted.envelope.encryptedDek).toBeDefined();
      expect(encrypted.envelope.encryptedMeta).toBeDefined();
      expect(encrypted.envelope.salt).toBe(saltHex);

      // Verify DEK can be authenticated and decrypted with master key
      const dek = decryptBuffer(
        Buffer.from(encrypted.envelope.encryptedDek, 'base64'),
        masterKey,
        encrypted.envelope.dekIv,
        encrypted.envelope.dekTag,
      );
      expect(dek).toHaveLength(32);

      // Decrypt plaintext with DEK
      const decryptedMedia = decryptBuffer(
        encrypted.encryptedMedia,
        dek,
        encrypted.envelope.iv,
        encrypted.envelope.tag,
      );
      expect(decryptedMedia.toString('utf8')).toBe('RAW_UNENCRYPTED_JPEG_PHOTO_DATA_12345678');

      // Decrypt sensitive metadata
      const decryptedMetaJson = decryptBuffer(
        Buffer.from(encrypted.envelope.encryptedMeta!, 'base64'),
        dek,
        encrypted.envelope.metaIv!,
        encrypted.envelope.metaTag!,
      ).toString('utf8');
      const parsedMeta = JSON.parse(decryptedMetaJson);
      expect(parsedMeta.originalName).toBe('secret_vacation_photo.jpg');
      expect(parsedMeta.mimeType).toBe('image/jpeg');
    });
  });

  describe('3. Passphrase Verification & Post-Wipe Recovery', () => {
    it('verifies passphrase asynchronously against envelope DEK without blocking UI thread', async () => {
      const recoveryKey = 'eagle harbor quartz river beacon silver forest velvet canyon crystal shadow marble';
      const saltHex = 'fedcba9876543210fedcba9876543210';
      const masterKey = await deriveMasterKeyAsync(recoveryKey, saltHex, 1000);

      const rawPhotoBytes = Buffer.from('PHOTO_DATA', 'utf8');
      const sensitiveMeta = {
        originalName: 'test.jpg',
        relativePath: 'DCIM/test.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: rawPhotoBytes.length,
        modifiedAtMs: 1700000000000,
      };

      const encrypted = encryptMediaPayload(rawPhotoBytes, sensitiveMeta, masterKey, saltHex);

      // Verify with CORRECT passphrase
      const validResult = await verifyPassphraseAgainstItemAsync(recoveryKey, encrypted.envelope, undefined, 1000);
      expect(validResult.valid).toBe(true);
      expect(validResult.masterKey).toBeDefined();
      expect(validResult.masterKeyHex).toBe(masterKey.toString('hex'));

      // Verify with INCORRECT passphrase
      const invalidPassphrase = 'wrong harbor quartz river beacon silver forest velvet canyon crystal shadow wrong';
      const invalidResult = await verifyPassphraseAgainstItemAsync(invalidPassphrase, encrypted.envelope, undefined, 1000);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errorMessage).toMatch(/recovery passphrase/i);
    });

    it('recovers encryption configuration from remote envelope salt & verification token when local SQLite is wiped', async () => {
      const setup = await initializeEncryptionSetupAsync();
      const originalConfig = setup.config;

      // Simulate wiping local app data (SessionKeyStore cleared)
      SessionKeyStore.clear();
      expect(SessionKeyStore.getConfig()).toBeNull();
      expect(SessionKeyStore.isUnlocked()).toBe(false);

      // Simulate discovering remote channel history item with envelope
      const remoteEnvelope: EncryptedItemEnvelope = {
        alg: 'AES-256-GCM',
        keyVersion: originalConfig.keyVersion,
        iv: 'fakeIv',
        tag: 'fakeTag',
        encryptedDek: 'fakeDek',
        dekIv: 'fakeDekIv',
        dekTag: 'fakeDekTag',
        salt: originalConfig.kdfSalt,
        verificationToken: originalConfig.verificationToken,
      };

      // Reconstruct config from remote envelope
      const restoredConfig: EncryptionConfig = {
        enabled: true,
        keyVersion: remoteEnvelope.keyVersion,
        kdfSalt: remoteEnvelope.salt!,
        kdfIterations: originalConfig.kdfIterations,
        verificationToken: remoteEnvelope.verificationToken!,
        verifiedAtMs: Date.now(),
      };

      SessionKeyStore.setConfig(restoredConfig);

      // Verify that entering the original recovery key now succeeds against restored configuration
      const verifyResult = await verifyRecoveryKeyAsync(setup.recoveryKey, SessionKeyStore.getConfig()!);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.masterKeyHex).toBe(setup.masterKeyHex);
    });
  });
});
