import {
  createEncryptedCaptionEnvelope,
  decryptBuffer,
  decryptMediaPayload,
  deriveMasterKey,
  encryptBuffer,
  encryptMediaPayload,
  generateRecoveryKey,
  initializeEncryptionSetup,
  normalizeRecoveryKey,
  verifyRecoveryKey,
} from '../src/domain/crypto/encryptionService';
import {
  parseMetadataCaption,
  serializeMetadataCaption,
} from '../src/domain/telegram/metadata';
import { SensitiveMediaMetadata } from '../src/types/encryption';

describe('Client-Side Encryption Service (Gate E)', () => {
  describe('Recovery Key & Key Derivation (PBKDF2)', () => {
    it('generates a 12-word high-entropy recovery key', () => {
      const key = generateRecoveryKey();
      expect(typeof key).toBe('string');
      const words = key.split(' ');
      expect(words).toHaveLength(12);
      words.forEach(w => expect(w.length).toBeGreaterThanOrEqual(3));
    });

    it('normalizes recovery key case and whitespace', () => {
      const dirty = '  ALPHA   Beacon \n canyon \t delta ';
      const normalized = normalizeRecoveryKey(dirty);
      expect(normalized).toBe('alpha beacon canyon delta');
    });

    it('derives a deterministic 256-bit (32-byte) Master Key from recovery key and salt', () => {
      const recoveryKey =
        'alpha beacon canyon delta eagle forest galaxy harbor island jungle kinetic lagoon';
      const saltHex = '0123456789abcdef0123456789abcdef';

      const key1 = deriveMasterKey(recoveryKey, saltHex, 1000);
      const key2 = deriveMasterKey(recoveryKey, saltHex, 1000);

      expect(key1).toHaveLength(32);
      expect(key1.equals(key2)).toBe(true);

      // Different salt produces different master key
      const keyDifferentSalt = deriveMasterKey(
        recoveryKey,
        'fedcba9876543210fedcba9876543210',
        1000,
      );
      expect(key1.equals(keyDifferentSalt)).toBe(false);
    });

    it('initializes setup with verifiable token and accepts the recovery key', () => {
      const setup = initializeEncryptionSetup();
      expect(setup.config.enabled).toBe(true);
      expect(setup.config.kdfSalt).toHaveLength(32); // 16 bytes hex
      expect(setup.config.verificationToken).toBeTruthy();

      const verification = verifyRecoveryKey(setup.recoveryKey, setup.config);
      expect(verification.valid).toBe(true);
      expect(verification.masterKeyHex).toBe(setup.masterKeyHex);
    });

    it('rejects incorrect recovery key with descriptive error', () => {
      const setup = initializeEncryptionSetup();
      const wrongKey =
        'wrong word list that definitely does not match original setup';

      const verification = verifyRecoveryKey(wrongKey, setup.config);
      expect(verification.valid).toBe(false);
      expect(verification.errorMessage).toBeTruthy();
    });

    it('gracefully fails verification on malformed or tampered verification token', () => {
      const setup = initializeEncryptionSetup();
      const tamperedConfig = {
        ...setup.config,
        verificationToken: JSON.stringify({ iv: 'bad', tag: 'bad', ct: 'bad' }),
      };

      const verification = verifyRecoveryKey(setup.recoveryKey, tamperedConfig);
      expect(verification.valid).toBe(false);
    });
  });

  describe('AES-256-GCM Media & Metadata Encryption', () => {
    const masterKey = Buffer.alloc(32, 0x42);
    const plaintextMedia = Buffer.from(
      'RAW_PHOTO_IMAGE_BINARY_DATA_2026',
      'utf8',
    );
    const sensitiveMeta: SensitiveMediaMetadata = {
      originalName: 'IMG_CONFIDENTIAL_2026.jpg',
      relativePath: 'DCIM/Private/IMG_CONFIDENTIAL_2026.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: plaintextMedia.length,
      modifiedAtMs: 1792660000000,
      contentHash: 'hash_abc123_sensitive',
    };

    it('encrypts and decrypts media payload preserving original bytes and metadata', () => {
      const { encryptedMedia, envelope } = encryptMediaPayload(
        plaintextMedia,
        sensitiveMeta,
        masterKey,
      );

      expect(envelope.alg).toBe('AES-256-GCM');
      expect(envelope.keyVersion).toBe(1);
      expect(encryptedMedia).not.toEqual(plaintextMedia);

      const { decryptedMedia, metadata } = decryptMediaPayload(
        encryptedMedia,
        envelope,
        masterKey,
      );

      expect(decryptedMedia.toString('utf8')).toBe(
        'RAW_PHOTO_IMAGE_BINARY_DATA_2026',
      );
      expect(metadata.originalName).toBe('IMG_CONFIDENTIAL_2026.jpg');
      expect(metadata.relativePath).toBe(
        'DCIM/Private/IMG_CONFIDENTIAL_2026.jpg',
      );
      expect(metadata.contentHash).toBe('hash_abc123_sensitive');
      expect(metadata.sizeBytes).toBe(plaintextMedia.length);
      expect(metadata.modifiedAtMs).toBe(1792660000000);
    });

    it('generates unique random DEKs and IVs per encryption call', () => {
      const enc1 = encryptMediaPayload(
        plaintextMedia,
        sensitiveMeta,
        masterKey,
      );
      const enc2 = encryptMediaPayload(
        plaintextMedia,
        sensitiveMeta,
        masterKey,
      );

      // Ciphertext must differ even for identical plaintext
      expect(enc1.encryptedMedia.equals(enc2.encryptedMedia)).toBe(false);
      expect(enc1.envelope.iv).not.toBe(enc2.envelope.iv);
      expect(enc1.envelope.encryptedDek).not.toBe(enc2.envelope.encryptedDek);
    });

    it('encrypts and decrypts raw buffer using AES-256-GCM', () => {
      const raw = Buffer.from('hello-raw-buffer', 'utf8');
      const { ciphertext, iv, tag } = encryptBuffer(raw, masterKey);
      const decrypted = decryptBuffer(ciphertext, masterKey, iv, tag);
      expect(decrypted.toString('utf8')).toBe('hello-raw-buffer');
    });

    it('detects tampering and throws AEAD authentication error if media ciphertext is corrupted', () => {
      const { encryptedMedia, envelope } = encryptMediaPayload(
        plaintextMedia,
        sensitiveMeta,
        masterKey,
      );

      const tamperedMedia = Buffer.from(encryptedMedia);
      tamperedMedia[0] = (tamperedMedia[0] + 1) % 256; // modify 1 byte

      expect(() => {
        decryptMediaPayload(tamperedMedia, envelope, masterKey);
      }).toThrow();
    });

    it('detects tampering if DEK or metadata tag is corrupted', () => {
      const { encryptedMedia, envelope } = encryptMediaPayload(
        plaintextMedia,
        sensitiveMeta,
        masterKey,
      );

      const tamperedEnvelope = {
        ...envelope,
        tag: Buffer.alloc(16, 0).toString('base64'),
      };

      expect(() => {
        decryptMediaPayload(encryptedMedia, tamperedEnvelope, masterKey);
      }).toThrow();
    });
  });

  describe('Plaintext Metadata Leakage Audit (Security & Privacy)', () => {
    it('ensures caption envelope NEVER exposes sensitive filenames, paths, or hashes', () => {
      const masterKey = Buffer.alloc(32, 0xaa);
      const plaintextMedia = Buffer.from('Test Secret Video File', 'utf8');
      const sensitiveMeta: SensitiveMediaMetadata = {
        originalName: 'passport_scan_john_doe.jpg',
        relativePath: 'Documents/Identity/passport_scan_john_doe.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: plaintextMedia.length,
        modifiedAtMs: 1792670000000,
        contentHash: 'super_secret_sha256_hash_value',
      };

      const { encryptedMedia, envelope } = encryptMediaPayload(
        plaintextMedia,
        sensitiveMeta,
        masterKey,
      );

      const captionEnvelope = createEncryptedCaptionEnvelope(
        'media-id-12345',
        'photo',
        encryptedMedia.length,
        envelope,
      );

      const serializedCaption = serializeMetadataCaption(captionEnvelope);

      // STRICT AUDIT CHECKS: Plaintext leakage forbidden
      expect(serializedCaption).not.toContain('passport');
      expect(serializedCaption).not.toContain('john_doe');
      expect(serializedCaption).not.toContain('Identity');
      expect(serializedCaption).not.toContain('Documents');
      expect(serializedCaption).not.toContain('super_secret_sha256_hash_value');

      // Envelope must contain generic masked placeholders
      expect(captionEnvelope.originalName).toBe('encrypted.bin');
      expect(captionEnvelope.relativePath).toBe('');
      expect(captionEnvelope.contentHash).toBeNull();

      // Ensure remote-index recoverability: roundtrip parsing and decryption
      const parsedCaption = parseMetadataCaption(serializedCaption);
      expect(parsedCaption).not.toBeNull();
      expect(parsedCaption?.encryptionEnvelope).toBeTruthy();

      const parsedEncEnvelope =
        parsedCaption?.encryptionEnvelope as typeof envelope;
      const { metadata: restoredMeta } = decryptMediaPayload(
        encryptedMedia,
        parsedEncEnvelope,
        masterKey,
      );

      expect(restoredMeta.originalName).toBe('passport_scan_john_doe.jpg');
      expect(restoredMeta.relativePath).toBe(
        'Documents/Identity/passport_scan_john_doe.jpg',
      );
      expect(restoredMeta.contentHash).toBe('super_secret_sha256_hash_value');
    });
  });
});
