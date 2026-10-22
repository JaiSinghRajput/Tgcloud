import crypto from 'crypto';
import {
  EncryptedItemEnvelope,
  EncryptionConfig,
  RecoveryKeySetup,
  SensitiveMediaMetadata,
  VerifyKeyResult,
} from '../../types/encryption';
import { TelegramMetadataEnvelope } from '../../types/telegram';
import {
  APP_IDENTIFIER,
  CURRENT_METADATA_SCHEMA_VERSION,
} from '../telegram/metadata';

export const CURRENT_ENCRYPTION_KEY_VERSION = 1;
export const PBKDF2_ITERATIONS = 100000;
export const KEY_LENGTH_BYTES = 32; // 256 bits
export const IV_LENGTH_BYTES = 12; // 96 bits recommended for AES-GCM
export const SALT_LENGTH_BYTES = 16;
export const VERIFY_PAYLOAD_CONSTANT = 'TGB_RECOVERY_KEY_VERIFIED_V1';

const WORDLIST = [
  'alpha',
  'beacon',
  'canyon',
  'delta',
  'eagle',
  'forest',
  'galaxy',
  'harbor',
  'island',
  'jungle',
  'kinetic',
  'lagoon',
  'meadow',
  'nebula',
  'ocean',
  'pulse',
  'quartz',
  'river',
  'solar',
  'timber',
  'ultra',
  'valley',
  'winter',
  'zenith',
  'amber',
  'breeze',
  'cloud',
  'dawn',
  'ember',
  'flame',
  'glacier',
  'horizon',
];

/**
 * Generates a high-entropy 12-word recovery passphrase.
 */
export function generateRecoveryKey(): string {
  const randomBytes = crypto.randomBytes(12);
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const byte = randomBytes[i];
    const wordIndex = byte % WORDLIST.length;
    words.push(WORDLIST[wordIndex]);
  }
  return words.join(' ');
}

/**
 * Normalizes user-entered recovery key by trimming, lowercasing, and normalizing whitespace.
 */
export function normalizeRecoveryKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Derives a 256-bit Master Key from a recovery key using PBKDF2-HMAC-SHA256.
 */
export function deriveMasterKey(
  recoveryKey: string,
  saltHex: string,
  iterations: number = PBKDF2_ITERATIONS,
): Buffer {
  const normalizedKey = normalizeRecoveryKey(recoveryKey);
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(
    normalizedKey,
    salt,
    iterations,
    KEY_LENGTH_BYTES,
    'sha256',
  );
}

/**
 * Encrypts a small plaintext buffer using AES-256-GCM.
 */
export function encryptBuffer(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypts a ciphertext buffer using AES-256-GCM.
 * Throws an error if authentication tag verification fails (tamper detection).
 */
export function decryptBuffer(
  ciphertext: Buffer,
  key: Buffer,
  ivBase64: string,
  tagBase64: string,
): Buffer {
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Creates a verification token encrypted under the master key.
 */
export function createVerificationToken(masterKey: Buffer): string {
  const payload = Buffer.from(VERIFY_PAYLOAD_CONSTANT, 'utf8');
  const { ciphertext, iv, tag } = encryptBuffer(payload, masterKey);
  return JSON.stringify({
    iv,
    tag,
    ct: ciphertext.toString('base64'),
  });
}

/**
 * Verifies if a given recovery key can decrypt the stored verification token.
 */
export function verifyRecoveryKey(
  recoveryKey: string,
  config: EncryptionConfig,
): VerifyKeyResult {
  try {
    const masterKey = deriveMasterKey(
      recoveryKey,
      config.kdfSalt,
      config.kdfIterations,
    );
    const tokenObj = JSON.parse(config.verificationToken);
    const ciphertext = Buffer.from(tokenObj.ct, 'base64');
    const decrypted = decryptBuffer(
      ciphertext,
      masterKey,
      tokenObj.iv,
      tokenObj.tag,
    );

    if (decrypted.toString('utf8') === VERIFY_PAYLOAD_CONSTANT) {
      return {
        valid: true,
        masterKeyHex: masterKey.toString('hex'),
      };
    }
    return {
      valid: false,
      errorMessage: 'Verification payload mismatch.',
    };
  } catch (err) {
    return {
      valid: false,
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Invalid recovery key or corrupted verification token.',
    };
  }
}

/**
 * Initializes a new client-side encryption setup with recovery key, salt, and verification token.
 */
export function initializeEncryptionSetup(): RecoveryKeySetup {
  const recoveryKey = generateRecoveryKey();
  const salt = crypto.randomBytes(SALT_LENGTH_BYTES);
  const saltHex = salt.toString('hex');
  const masterKey = deriveMasterKey(recoveryKey, saltHex, PBKDF2_ITERATIONS);
  const verificationToken = createVerificationToken(masterKey);

  const config: EncryptionConfig = {
    enabled: true,
    kdfSalt: saltHex,
    kdfIterations: PBKDF2_ITERATIONS,
    verificationToken,
    keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
    verifiedAtMs: Date.now(),
  };

  return {
    recoveryKey,
    config,
    masterKeyHex: masterKey.toString('hex'),
  };
}

/**
 * Encrypts a media file buffer and its sensitive metadata using a fresh random DEK.
 * The DEK and sensitive metadata are wrapped with the Master Key.
 */
export function encryptMediaPayload(
  plaintextMedia: Buffer,
  sensitiveMeta: SensitiveMediaMetadata,
  masterKey: Buffer,
): { encryptedMedia: Buffer; envelope: EncryptedItemEnvelope } {
  // 1. Generate fresh random 256-bit DEK
  const dek = crypto.randomBytes(KEY_LENGTH_BYTES);

  // 2. Encrypt media content with DEK
  const mediaEnc = encryptBuffer(plaintextMedia, dek);

  // 3. Encrypt sensitive metadata JSON with DEK
  const metaJson = Buffer.from(JSON.stringify(sensitiveMeta), 'utf8');
  const metaEnc = encryptBuffer(metaJson, dek);

  // 4. Encrypt DEK with Master Key
  const dekEnc = encryptBuffer(dek, masterKey);

  const envelope: EncryptedItemEnvelope = {
    alg: 'AES-256-GCM',
    keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
    iv: mediaEnc.iv,
    tag: mediaEnc.tag,
    encryptedDek: dekEnc.ciphertext.toString('base64'),
    dekIv: dekEnc.iv,
    dekTag: dekEnc.tag,
    encryptedMeta: metaEnc.ciphertext.toString('base64'),
    metaIv: metaEnc.iv,
    metaTag: metaEnc.tag,
  };

  return {
    encryptedMedia: mediaEnc.ciphertext,
    envelope,
  };
}

/**
 * Decrypts an encrypted media payload and restores original sensitive metadata.
 */
export function decryptMediaPayload(
  encryptedMedia: Buffer,
  envelope: EncryptedItemEnvelope,
  masterKey: Buffer,
): { decryptedMedia: Buffer; metadata: SensitiveMediaMetadata } {
  if (envelope.alg !== 'AES-256-GCM') {
    throw new Error(`Unsupported encryption algorithm: ${envelope.alg}`);
  }

  // 1. Decrypt DEK using Master Key
  const encryptedDekBuffer = Buffer.from(envelope.encryptedDek, 'base64');
  const dek = decryptBuffer(
    encryptedDekBuffer,
    masterKey,
    envelope.dekIv,
    envelope.dekTag,
  );

  // 2. Decrypt media content using DEK
  const decryptedMedia = decryptBuffer(
    encryptedMedia,
    dek,
    envelope.iv,
    envelope.tag,
  );

  // 3. Decrypt sensitive metadata
  let metadata: SensitiveMediaMetadata;
  if (envelope.encryptedMeta && envelope.metaIv && envelope.metaTag) {
    const encryptedMetaBuffer = Buffer.from(envelope.encryptedMeta, 'base64');
    const metaJson = decryptBuffer(
      encryptedMetaBuffer,
      dek,
      envelope.metaIv,
      envelope.metaTag,
    ).toString('utf8');
    metadata = JSON.parse(metaJson);
  } else {
    // Fallback if metadata was not encrypted separately
    metadata = {
      originalName: 'restored_media.bin',
      relativePath: '',
      mimeType: 'application/octet-stream',
      sizeBytes: decryptedMedia.length,
      modifiedAtMs: Date.now(),
    };
  }

  return {
    decryptedMedia,
    metadata,
  };
}

/**
 * Creates a privacy-preserving Telegram metadata envelope for encrypted uploads.
 * Sensitive fields (filename, path, content hash) are masked with non-identifying values.
 */
export function createEncryptedCaptionEnvelope(
  mediaId: string,
  mediaType: 'photo' | 'video',
  encryptedMediaSizeBytes: number,
  envelope: EncryptedItemEnvelope,
): TelegramMetadataEnvelope {
  return {
    schemaVersion: CURRENT_METADATA_SCHEMA_VERSION,
    app: APP_IDENTIFIER,
    mediaId,
    mediaType,
    originalName: 'encrypted.bin',
    relativePath: '',
    mimeType: 'application/octet-stream',
    sizeBytes: encryptedMediaSizeBytes,
    modifiedAtMs: 0,
    contentHash: null,
    encryptionEnvelope: envelope,
  };
}
