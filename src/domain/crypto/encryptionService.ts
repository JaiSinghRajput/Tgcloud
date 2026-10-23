/* eslint-disable no-bitwise */
import { Buffer } from 'buffer';
import {
  EncryptedItemEnvelope,
  EncryptionConfig,
  EncryptionSetupState,
  EncryptionStatus,
  RecoveryKeySetup,
  SensitiveMediaMetadata,
  UnlockErrorCode,
  UnlockResult,
  VerifyKeyResult,
} from '../../types/encryption';
import { TelegramMetadataEnvelope } from '../../types/telegram';
import {
  APP_IDENTIFIER,
  CURRENT_METADATA_SCHEMA_VERSION,
} from '../telegram/metadata';
import { TelegramBridgeService } from '../../native/TelegramBridge';

// Dynamic crypto loader: in Node.js (Jest) loads Node built-in crypto, while in React Native Metro avoids static dependency resolution
const getNodeCrypto = (): any => {
  try {
    const modName = 'cry' + 'pto';
    return typeof require !== 'undefined' ? require(modName) : null;
  } catch {
    return null;
  }
};
const nodeCrypto = getNodeCrypto();

export const CURRENT_ENCRYPTION_KEY_VERSION = 1;
export const PBKDF2_ITERATIONS = 100000;
export const KEY_LENGTH_BYTES = 32; // 256 bits
export const IV_LENGTH_BYTES = 12; // 96 bits recommended for AES-GCM
export const SALT_LENGTH_BYTES = 16;
export const VERIFY_PAYLOAD_CONSTANT = 'TGB_RECOVERY_KEY_VERIFIED_V1';

export function getRandomBytes(length: number): Uint8Array {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }
  if (nodeCrypto?.randomBytes) {
    return nodeCrypto.randomBytes(length);
  }
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

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
 * Pure JS SHA-256 implementation used as a fallback when Node crypto and native modules are absent.
 */
function pureJsSha256(data: Uint8Array): Uint8Array {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const words = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  words.set(data);
  words[data.length] = 0x80;
  const view = new DataView(words.buffer);
  view.setUint32(words.length - 4, data.length * 8, false);

  for (let j = 0; j < words.length; j += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(j + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3],
        e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  const res = new Uint8Array(32);
  const resView = new DataView(res.buffer);
  for (let i = 0; i < 8; i++) resView.setUint32(i * 4, hash[i], false);
  return res;
}

/**
 * Pure JS HMAC-SHA256 implementation.
 */
function pureJsHmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) {
    k = pureJsSha256(k);
  }
  const kPad = new Uint8Array(64);
  kPad.set(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = kPad[i] ^ 0x36;
    opad[i] = kPad[i] ^ 0x5c;
  }
  const inner = new Uint8Array(64 + message.length);
  inner.set(ipad);
  inner.set(message, 64);
  const innerHash = pureJsSha256(inner);

  const outer = new Uint8Array(64 + 32);
  outer.set(opad);
  outer.set(innerHash, 64);
  return pureJsSha256(outer);
}

/**
 * Pure JS PBKDF2-HMAC-SHA256 key derivation.
 */
function pureJsPbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLengthBytes: number,
): Uint8Array {
  const result = new Uint8Array(keyLengthBytes);
  const numBlocks = Math.ceil(keyLengthBytes / 32);

  for (let blockIdx = 1; blockIdx <= numBlocks; blockIdx++) {
    const saltWithBlock = new Uint8Array(salt.length + 4);
    saltWithBlock.set(salt);
    const view = new DataView(saltWithBlock.buffer);
    view.setUint32(salt.length, blockIdx, false);

    let u = pureJsHmacSha256(password, saltWithBlock);
    const blockXor = new Uint8Array(u);

    for (let iter = 1; iter < iterations; iter++) {
      u = pureJsHmacSha256(password, u);
      for (let i = 0; i < 32; i++) {
        blockXor[i] ^= u[i];
      }
    }

    const offset = (blockIdx - 1) * 32;
    const count = Math.min(32, keyLengthBytes - offset);
    result.set(blockXor.subarray(0, count), offset);
  }

  return result;
}

/**
 * Generates a high-entropy 12-word recovery passphrase.
 */
export function generateRecoveryKey(): string {
  const randomBytes = getRandomBytes(12);
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
 * Synchronous PBKDF2-HMAC-SHA256 master key derivation.
 * Uses Node crypto if available, otherwise pure JS implementation.
 */
export function deriveMasterKey(
  recoveryKey: string,
  saltHex: string,
  iterations: number = PBKDF2_ITERATIONS,
): Buffer {
  const normalizedKey = normalizeRecoveryKey(recoveryKey);
  const salt = Buffer.from(saltHex, 'hex');

  if (nodeCrypto?.pbkdf2Sync) {
    return nodeCrypto.pbkdf2Sync(
      normalizedKey,
      salt,
      iterations,
      KEY_LENGTH_BYTES,
      'sha256',
    );
  }

  const passBytes = Buffer.from(normalizedKey, 'utf8');
  const derived = pureJsPbkdf2(passBytes, salt, iterations, KEY_LENGTH_BYTES);
  return Buffer.from(derived);
}

/**
 * Asynchronous master key derivation using hardware-accelerated Android native module
 * when running on a device, with seamless fallback.
 */
export async function deriveMasterKeyAsync(
  recoveryKey: string,
  saltHex: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<Buffer> {
  try {
    const keyHex = await TelegramBridgeService.deriveMasterKey(
      recoveryKey,
      saltHex,
      iterations,
    );
    if (keyHex && keyHex.length === 64) {
      return Buffer.from(keyHex, 'hex');
    }
  } catch {
    // Fall back to synchronous deriveMasterKey
  }
  return deriveMasterKey(recoveryKey, saltHex, iterations);
}

/**
 * Encrypts a small plaintext buffer using AES-256-GCM (or authenticated fallback).
 */
export function encryptBuffer(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: string; tag: string } {
  const iv = Buffer.from(getRandomBytes(IV_LENGTH_BYTES));
  if (nodeCrypto?.createCipheriv) {
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: encrypted,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  // Pure JS Authenticated Stream Fallback for React Native environments without node:crypto
  const streamKey = pureJsHmacSha256(key, iv);
  const ciphertext = Buffer.alloc(plaintext.length);
  for (let i = 0; i < plaintext.length; i++) {
    ciphertext[i] = plaintext[i] ^ streamKey[i % streamKey.length];
  }
  const tagData = pureJsHmacSha256(key, Buffer.concat([iv, ciphertext]));
  const tag = Buffer.from(tagData.subarray(0, 16));

  return {
    ciphertext,
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

  if (nodeCrypto?.createDecipheriv) {
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // Pure JS Authenticated Stream Fallback verification
  const expectedTag = pureJsHmacSha256(key, Buffer.concat([iv, ciphertext])).subarray(0, 16);
  if (!Buffer.from(expectedTag).equals(tag)) {
    throw new Error('Authentication tag mismatch. Tampered or incorrect key.');
  }

  const streamKey = pureJsHmacSha256(key, iv);
  const decrypted = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) {
    decrypted[i] = ciphertext[i] ^ streamKey[i % streamKey.length];
  }
  return decrypted;
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

export async function createVerificationTokenAsync(masterKey: Buffer): Promise<string> {
  try {
    const token = await TelegramBridgeService.createVerificationToken(masterKey.toString('hex'));
    if (token) return token;
  } catch {
    // Fall back
  }
  return createVerificationToken(masterKey);
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

export function verifyMasterKeyAgainstConfig(
  masterKey: Buffer,
  config: EncryptionConfig,
): boolean {
  try {
    if (!config.verificationToken) return false;
    const tokenObj = JSON.parse(config.verificationToken);
    const ciphertext = Buffer.from(tokenObj.ct, 'base64');
    const decrypted = decryptBuffer(
      ciphertext,
      masterKey,
      tokenObj.iv,
      tokenObj.tag,
    );
    return decrypted.toString('utf8') === VERIFY_PAYLOAD_CONSTANT;
  } catch {
    return false;
  }
}

export async function verifyRecoveryKeyAsync(
  recoveryKey: string,
  config: EncryptionConfig,
): Promise<VerifyKeyResult> {
  try {
    const valid = await TelegramBridgeService.verifyRecoveryKey(
      recoveryKey,
      config.kdfSalt,
      config.verificationToken,
    );
    if (valid) {
      const masterKey = await deriveMasterKeyAsync(
        recoveryKey,
        config.kdfSalt,
        config.kdfIterations,
      );
      return {
        valid: true,
        masterKeyHex: masterKey.toString('hex'),
      };
    }
  } catch {
    // Fall back to synchronous
  }
  return verifyRecoveryKey(recoveryKey, config);
}

/**
 * Initializes a new client-side encryption setup with recovery key, salt, and verification token.
 * Synchronous version for testing and environments with Node crypto.
 */
export function initializeEncryptionSetup(): RecoveryKeySetup {
  const recoveryKey = generateRecoveryKey();
  const salt = Buffer.from(getRandomBytes(SALT_LENGTH_BYTES));
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
 * Asynchronous initialization of client-side encryption.
 * Leverages hardware-accelerated Android native module on devices.
 */
export async function initializeEncryptionSetupAsync(): Promise<RecoveryKeySetup> {
  const recoveryKey = generateRecoveryKey();
  const salt = Buffer.from(getRandomBytes(SALT_LENGTH_BYTES));
  const saltHex = salt.toString('hex');
  const masterKey = await deriveMasterKeyAsync(recoveryKey, saltHex, PBKDF2_ITERATIONS);
  const verificationToken = await createVerificationTokenAsync(masterKey);

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
  saltHex?: string,
  verificationToken?: string,
): { encryptedMedia: Buffer; envelope: EncryptedItemEnvelope } {
  // 1. Generate fresh random 256-bit DEK
  const dek = Buffer.from(getRandomBytes(KEY_LENGTH_BYTES));

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
    ...(saltHex ? { salt: saltHex } : {}),
    ...(verificationToken ? { verificationToken } : {}),
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

/**
 * In-memory Session Key Store holding decrypted Master Key during active user session.
 * Never persists raw secret to disk, logs, or analytics.
 */
class SessionKeyStoreManager {
  private inMemoryMasterKey: Buffer | null = null;
  private inMemoryRecoveryKey: string | null = null;
  private encryptionConfig: EncryptionConfig | null = null;

  setSessionKey(masterKey: Buffer, recoveryKey?: string, config?: EncryptionConfig) {
    this.inMemoryMasterKey = masterKey;
    if (recoveryKey) this.inMemoryRecoveryKey = recoveryKey;
    if (config) this.encryptionConfig = config;
  }

  getSessionKey(): Buffer | null {
    return this.inMemoryMasterKey;
  }

  getRecoveryKey(): string | null {
    return this.inMemoryRecoveryKey;
  }

  getConfig(): EncryptionConfig | null {
    return this.encryptionConfig;
  }

  setConfig(config: EncryptionConfig) {
    this.encryptionConfig = config;
  }

  isUnlocked(): boolean {
    return this.inMemoryMasterKey !== null;
  }

  /**
   * Explicit Lock: Clears sensitive in-memory key material and destroys the
   * hardware-backed Keystore unlock token so encryption cannot be unlocked without the passphrase.
   */
  async lockEncryption(): Promise<void> {
    this.clear();
    await clearPersistedMasterKey();
  }

  clearConfig() {
    this.encryptionConfig = null;
  }

  clear() {
    if (this.inMemoryMasterKey) {
      this.inMemoryMasterKey.fill(0);
      this.inMemoryMasterKey = null;
    }
    this.inMemoryRecoveryKey = null;
  }
}

export const SessionKeyStore = new SessionKeyStoreManager();

/**
 * Persists the derived master key in Android Keystore-backed secure storage.
 * The raw recovery passphrase is NEVER stored.
 */
export async function persistMasterKeySecurely(masterKeyHex: string): Promise<boolean> {
  try {
    return await TelegramBridgeService.storeSecureMasterKey(masterKeyHex);
  } catch (err) {
    console.warn('Failed to securely persist master key in Keystore:', err);
    return false;
  }
}

/**
 * Attempts to load the persisted master key from Android Keystore-backed secure storage.
 * Returns Buffer if available, or null if locked, absent, or reset.
 */
export async function loadPersistedMasterKey(): Promise<Buffer | null> {
  try {
    const hex = await TelegramBridgeService.loadSecureMasterKey();
    if (hex && hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
    return null;
  } catch (err) {
    console.warn('Failed to load persisted master key from Keystore:', err);
    throw err;
  }
}

/**
 * Explicitly clears the Keystore-persisted master key, locking encryption across restarts.
 */
export async function clearPersistedMasterKey(): Promise<boolean> {
  try {
    return await TelegramBridgeService.clearSecureMasterKey();
  } catch (err) {
    console.warn('Failed to clear persisted master key:', err);
    return false;
  }
}

export async function isSecureKeyPersistenceAvailable(): Promise<boolean> {
  try {
    return await TelegramBridgeService.isSecureStorageAvailable();
  } catch {
    return false;
  }
}

/**
 * Securely persists the non-secret encryption configuration metadata (salt, iterations, verification token)
 * so it survives app closures, process death, and restarts alongside the protected key.
 */
export async function persistEncryptionConfigSecurely(config: EncryptionConfig): Promise<boolean> {
  try {
    return await TelegramBridgeService.storeSecureEncryptionConfig(JSON.stringify(config));
  } catch (err) {
    console.warn('Failed to securely persist encryption config:', err);
    return false;
  }
}

/**
 * Loads the persisted non-secret encryption configuration from secure storage.
 */
export async function loadPersistedEncryptionConfig(): Promise<EncryptionConfig | null> {
  try {
    const jsonStr = await TelegramBridgeService.loadSecureEncryptionConfig();
    if (jsonStr) {
      return JSON.parse(jsonStr) as EncryptionConfig;
    }
    return null;
  } catch (err) {
    console.warn('Failed to load persisted encryption config:', err);
    return null;
  }
}

/**
 * Clears the persisted encryption configuration upon explicit data wipe.
 */
export async function clearPersistedEncryptionConfig(): Promise<boolean> {
  try {
    SessionKeyStore.clearConfig();
    return await TelegramBridgeService.clearSecureEncryptionConfig();
  } catch (err) {
    return false;
  }
}

/**
 * Attempts authenticated verification of a recovery passphrase against an encrypted object's DEK.
 * Since AES-256-GCM is an authenticated cipher, successful decryption of encryptedDek guarantees the key is authentic!
 */
export function verifyPassphraseAgainstItem(
  recoveryKey: string,
  envelope: EncryptedItemEnvelope,
  fallbackSaltHex?: string,
  iterations: number = PBKDF2_ITERATIONS,
): { valid: boolean; masterKey?: Buffer; masterKeyHex?: string; errorMessage?: string } {
  try {
    const saltHex = envelope.salt || fallbackSaltHex;
    if (!saltHex) {
      return {
        valid: false,
        errorMessage: 'Salt missing from encrypted envelope. Cannot derive key.',
      };
    }

    const masterKey = deriveMasterKey(recoveryKey, saltHex, iterations);
    const dekBuffer = Buffer.from(envelope.encryptedDek, 'base64');
    const dek = decryptBuffer(dekBuffer, masterKey, envelope.dekIv, envelope.dekTag);

    if (dek && dek.length === KEY_LENGTH_BYTES) {
      return {
        valid: true,
        masterKey,
        masterKeyHex: masterKey.toString('hex'),
      };
    }

    return {
      valid: false,
      errorMessage: 'Decrypted key size mismatch.',
    };
  } catch (err) {
    return {
      valid: false,
      errorMessage:
        err instanceof Error && err.message.includes('authenticate')
          ? 'Incorrect recovery passphrase. Authentication tag mismatch.'
          : 'Invalid recovery passphrase.',
    };
  }
}

/**
 * Asynchronous, hardware-accelerated verification of a recovery passphrase against an item's DEK.
 * Prevents UI freezes on mobile devices during PBKDF2 calculation.
 */
export async function verifyPassphraseAgainstItemAsync(
  recoveryKey: string,
  envelope: EncryptedItemEnvelope,
  fallbackSaltHex?: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<{ valid: boolean; masterKey?: Buffer; masterKeyHex?: string; errorMessage?: string }> {
  try {
    const saltHex = envelope.salt || fallbackSaltHex;
    if (!saltHex) {
      return {
        valid: false,
        errorMessage: 'Salt missing from encrypted envelope. Cannot derive key.',
      };
    }

    const masterKey = await deriveMasterKeyAsync(recoveryKey, saltHex, iterations);
    const dekBuffer = Buffer.from(envelope.encryptedDek, 'base64');
    const dek = decryptBuffer(dekBuffer, masterKey, envelope.dekIv, envelope.dekTag);

    if (dek && dek.length === KEY_LENGTH_BYTES) {
      return {
        valid: true,
        masterKey,
        masterKeyHex: masterKey.toString('hex'),
      };
    }

    return {
      valid: false,
      errorMessage: 'Decrypted key size mismatch.',
    };
  } catch (err) {
    return {
      valid: false,
      errorMessage:
        err instanceof Error && err.message.includes('authenticate')
          ? 'Incorrect recovery passphrase. Authentication tag mismatch.'
          : 'Invalid recovery passphrase.',
    };
  }
}

/**
 * Detects whether key input is a 12/24-word recovery passphrase, a 64-char hex key, or unknown.
 */
export function detectKeyFormat(keyInput: string): 'passphrase' | 'hex' | 'unknown' {
  const trimmed = keyInput.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return 'hex';
  }
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 12 || words.length === 24) {
    return 'passphrase';
  }
  return 'unknown';
}

/**
 * Validates and sets up an existing encryption key (Option A).
 * Supports 12/24-word passphrases and 64-character hex master keys.
 * Tests key against existing verification tokens or encrypted item envelopes.
 */
export async function setupExistingKeyAsync(
  keyInput: string,
  existingConfig?: EncryptionConfig | null,
  testEnvelope?: EncryptedItemEnvelope | null,
): Promise<{
  valid: boolean;
  state: EncryptionSetupState;
  setup?: RecoveryKeySetup;
  errorMessage?: string;
}> {
  const format = detectKeyFormat(keyInput);
  if (format === 'unknown') {
    return {
      valid: false,
      state: 'UNSUPPORTED_FORMAT',
      errorMessage:
        'Unrecognized key format. Accepted formats: 12-word recovery passphrase or 64-character hexadecimal key.',
    };
  }

  const normalized = normalizeRecoveryKey(keyInput);
  let masterKey: Buffer;
  let saltHex =
    existingConfig?.kdfSalt ||
    testEnvelope?.salt ||
    Buffer.from(getRandomBytes(SALT_LENGTH_BYTES)).toString('hex');

  try {
    if (format === 'hex') {
      masterKey = Buffer.from(keyInput.trim(), 'hex');
    } else {
      masterKey = await deriveMasterKeyAsync(normalized, saltHex, PBKDF2_ITERATIONS);
    }
  } catch (err: any) {
    return {
      valid: false,
      state: 'INVALID_KEY',
      errorMessage: `Key derivation failed: ${err?.message || 'Unknown error'}`,
    };
  }

  // Authenticated test against existing verification token if present
  if (existingConfig && existingConfig.verificationToken) {
    const testResult = await verifyRecoveryKeyAsync(normalized, existingConfig);
    if (!testResult.valid) {
      return {
        valid: false,
        state: 'INVALID_KEY',
        errorMessage: 'Incorrect recovery key. Does not match existing backup verification token.',
      };
    }
  } else if (testEnvelope) {
    // Authenticated test against existing encrypted object DEK
    const testResult = await verifyPassphraseAgainstItemAsync(normalized, testEnvelope, saltHex);
    if (!testResult.valid) {
      return {
        valid: false,
        state: 'INVALID_KEY',
        errorMessage: 'Incorrect recovery key. Failed to decrypt existing backup media.',
      };
    }
  }

  // Create verification token if none exists yet
  let verificationToken = existingConfig?.verificationToken;
  if (!verificationToken) {
    verificationToken = await createVerificationTokenAsync(masterKey);
  }

  const config: EncryptionConfig = {
    enabled: true,
    kdfSalt: saltHex,
    kdfIterations: PBKDF2_ITERATIONS,
    verificationToken,
    keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
    verifiedAtMs: Date.now(),
  };

  return {
    valid: true,
    state: 'ENABLED_UNLOCKED',
    setup: {
      recoveryKey: normalized,
      config,
      masterKeyHex: masterKey.toString('hex'),
    },
  };
}

/**
 * Validates whether a candidate 256-bit Master Key can authenticate and decrypt an encrypted object.
 * Uses AES-256-GCM authenticated decryption on verificationToken or encryptedDek.
 * If authentication tag fails or data is corrupted, returns false.
 */
export function validateKeyAgainstEncryptedObject(
  masterKey: Buffer,
  object: EncryptedItemEnvelope | string,
): boolean {
  try {
    if (!masterKey || masterKey.length !== KEY_LENGTH_BYTES) {
      return false;
    }
    const envelope: EncryptedItemEnvelope =
      typeof object === 'string' ? JSON.parse(object) : object;

    if (!envelope || typeof envelope !== 'object') {
      return false;
    }

    if (envelope.alg && envelope.alg !== 'AES-256-GCM') {
      return false;
    }

    // 1. If envelope carries verificationToken, test against that first
    if (envelope.verificationToken) {
      try {
        const tokenObj =
          typeof envelope.verificationToken === 'string'
            ? JSON.parse(envelope.verificationToken)
            : envelope.verificationToken;
        const ct = Buffer.from(tokenObj.ct, 'base64');
        const decrypted = decryptBuffer(ct, masterKey, tokenObj.iv, tokenObj.tag);
        if (decrypted.toString('utf8') === VERIFY_PAYLOAD_CONSTANT) {
          return true;
        }
      } catch {
        // Verification token auth tag mismatch
      }
    }

    // 2. If envelope carries an encrypted DEK, decrypt DEK with authenticated tag check
    if (envelope.encryptedDek && envelope.dekIv && envelope.dekTag) {
      const dekCiphertext = Buffer.from(envelope.encryptedDek, 'base64');
      const dek = decryptBuffer(dekCiphertext, masterKey, envelope.dekIv, envelope.dekTag);
      if (dek && dek.length === KEY_LENGTH_BYTES) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Single source of truth for Encryption & Key Management across the entire application.
 * Manages the encryption state machine:
 * INITIALIZING -> UNLOCKED | LOCKED | RECOVERY_REQUIRED | ERROR
 * Transitions to VALIDATING during passphrase checks.
 */
class UnifiedEncryptionServiceManager {
  private status: EncryptionStatus = 'INITIALIZING';
  private listeners: Set<(status: EncryptionStatus) => void> = new Set();
  private lastError: string | null = null;

  constructor() {
    if (SessionKeyStore.isUnlocked()) {
      this.status = 'UNLOCKED';
    }
  }

  getEncryptionStatus(): EncryptionStatus {
    if (SessionKeyStore.isUnlocked()) {
      return 'UNLOCKED';
    }
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  subscribe(listener: (status: EncryptionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(newStatus: EncryptionStatus, error?: string | null) {
    this.status = newStatus;
    if (error !== undefined) {
      this.lastError = error;
    }
    this.listeners.forEach(fn => {
      try {
        fn(newStatus);
      } catch (err) {
        console.warn('Listener error on encryption status change:', err);
      }
    });
  }

  async getPersistedKey(): Promise<Buffer | null> {
    return await loadPersistedMasterKey();
  }

  validateKeyAgainstEncryptedObject(
    masterKey: Buffer,
    object: EncryptedItemEnvelope | string,
  ): boolean {
    return validateKeyAgainstEncryptedObject(masterKey, object);
  }

  async persistProtectedKey(
    masterKey: Buffer | string,
    config?: EncryptionConfig,
  ): Promise<boolean> {
    const hex = typeof masterKey === 'string' ? masterKey : masterKey.toString('hex');
    const keySuccess = await persistMasterKeySecurely(hex);
    if (config) {
      await persistEncryptionConfigSecurely(config);
      SessionKeyStore.setConfig(config);
    }
    return keySuccess;
  }

  async lockEncryption(): Promise<void> {
    await SessionKeyStore.lockEncryption();
    this.setStatus('LOCKED', null);
  }

  async resetAll(): Promise<void> {
    await this.lockEncryption();
    await clearPersistedEncryptionConfig();
    this.setStatus('LOCKED', null);
  }

  /**
   * Restores encryption state securely on app startup.
   * 1. Initialize secure storage / verify Keystore availability.
   * 2. Load persisted encryption config metadata.
   * 3. Restore the protected master key.
   * 4. Authenticate the key against verification token.
   * 5. If valid, set session key and transition to UNLOCKED.
   * 6. If invalid or corrupted, transition to RECOVERY_REQUIRED.
   * 7. If no key, transition to LOCKED.
   */
  async restoreEncryptionOnStartup(): Promise<EncryptionStatus> {
    this.setStatus('INITIALIZING');
    try {
      const isStorageAvailable = await isSecureKeyPersistenceAvailable();
      if (!isStorageAvailable) {
        this.setStatus('ERROR', 'Secure Keystore storage is unavailable on this device.');
        return 'ERROR';
      }

      const persistedConfig = await loadPersistedEncryptionConfig();
      if (persistedConfig) {
        SessionKeyStore.setConfig(persistedConfig);
      }

      let persistedKey: Buffer | null = null;
      try {
        persistedKey = await loadPersistedMasterKey();
      } catch (err: any) {
        this.setStatus('ERROR', `Secure storage read failure: ${err?.message || 'Keystore error'}`);
        return 'ERROR';
      }

      if (persistedKey && persistedKey.length === KEY_LENGTH_BYTES) {
        if (persistedConfig && persistedConfig.verificationToken) {
          const isValid = verifyMasterKeyAgainstConfig(persistedKey, persistedConfig);
          if (isValid) {
            SessionKeyStore.setSessionKey(persistedKey, undefined, persistedConfig);
            this.setStatus('UNLOCKED', null);
            return 'UNLOCKED';
          } else {
            // Key mismatch or corrupted storage: clear invalidated key
            await clearPersistedMasterKey();
            this.setStatus(
              'RECOVERY_REQUIRED',
              'Persisted key failed cryptographic verification against backup token.',
            );
            return 'RECOVERY_REQUIRED';
          }
        } else {
          SessionKeyStore.setSessionKey(persistedKey, undefined, persistedConfig || undefined);
          this.setStatus('UNLOCKED', null);
          return 'UNLOCKED';
        }
      }

      this.setStatus('LOCKED', null);
      return 'LOCKED';
    } catch (err: any) {
      this.setStatus('ERROR', err?.message || 'Failed to initialize secure encryption storage.');
      return 'ERROR';
    }
  }

  /**
   * Canonical unlock implementation shared across the app.
   * Used by Settings, Cloud, backup upload queue, and media viewer.
   */
  async unlockWithPassphrase(
    passphraseInput: string,
    candidateEnvelopes?: (EncryptedItemEnvelope | string | null | undefined)[],
  ): Promise<UnlockResult> {
    if (!passphraseInput || typeof passphraseInput !== 'string') {
      return {
        success: false,
        status: this.getEncryptionStatus(),
        errorCode: 'INVALID_PASSPHRASE',
        errorMessage: 'Passphrase cannot be empty.',
      };
    }

    const trimmed = passphraseInput.trim();
    if (!trimmed) {
      return {
        success: false,
        status: this.getEncryptionStatus(),
        errorCode: 'INVALID_PASSPHRASE',
        errorMessage: 'Passphrase cannot be blank.',
      };
    }

    const format = detectKeyFormat(trimmed);
    if (format === 'unknown') {
      return {
        success: false,
        status: this.getEncryptionStatus(),
        errorCode: 'INVALID_PASSPHRASE',
        errorMessage:
          'Invalid passphrase format. Please enter your 12-word recovery passphrase or 64-character hex key.',
      };
    }

    this.setStatus('VALIDATING');

    try {
      const normalized = normalizeRecoveryKey(trimmed);
      let activeConfig = SessionKeyStore.getConfig();
      if (!activeConfig) {
        activeConfig = await loadPersistedEncryptionConfig();
        if (activeConfig) {
          SessionKeyStore.setConfig(activeConfig);
        }
      }

      // Parse candidate envelopes
      const parsedEnvelopes: EncryptedItemEnvelope[] = [];
      if (candidateEnvelopes && candidateEnvelopes.length > 0) {
        for (const item of candidateEnvelopes) {
          if (!item) continue;
          try {
            const parsed: EncryptedItemEnvelope =
              typeof item === 'string' ? JSON.parse(item) : item;
            if (parsed && typeof parsed === 'object') {
              parsedEnvelopes.push(parsed);
            }
          } catch {
            // Malformed JSON envelope
          }
        }
      }

      // 1. Try unlocking with activeConfig if available
      if (activeConfig && activeConfig.kdfSalt) {
        let masterKey: Buffer;
        if (format === 'hex') {
          masterKey = Buffer.from(trimmed, 'hex');
        } else {
          masterKey = await deriveMasterKeyAsync(
            normalized,
            activeConfig.kdfSalt,
            activeConfig.kdfIterations || PBKDF2_ITERATIONS,
          );
        }

        if (activeConfig.verificationToken) {
          const isValid = verifyMasterKeyAgainstConfig(masterKey, activeConfig);
          if (isValid) {
            SessionKeyStore.setSessionKey(masterKey, normalized, activeConfig);
            await this.persistProtectedKey(masterKey, activeConfig);
            this.setStatus('UNLOCKED', null);
            return {
              success: true,
              masterKey,
              masterKeyHex: masterKey.toString('hex'),
              config: activeConfig,
              status: 'UNLOCKED',
            };
          }
        }
      }

      // 2. Try candidate envelopes
      let hadAuthFailure = false;

      for (const env of parsedEnvelopes) {
        const candidateSalt = env.salt || activeConfig?.kdfSalt;
        if (!candidateSalt) continue;

        let candidateKey: Buffer;
        try {
          if (format === 'hex') {
            candidateKey = Buffer.from(trimmed, 'hex');
          } else {
            candidateKey = await deriveMasterKeyAsync(
              normalized,
              candidateSalt,
              PBKDF2_ITERATIONS,
            );
          }
        } catch {
          continue;
        }

        const isValid = validateKeyAgainstEncryptedObject(candidateKey, env);
        if (isValid) {
          let token = env.verificationToken;
          if (!token) {
            try {
              token = await createVerificationTokenAsync(candidateKey);
            } catch {
              token = createVerificationToken(candidateKey);
            }
          }

          const verifiedConfig: EncryptionConfig = {
            enabled: true,
            kdfSalt: candidateSalt,
            kdfIterations: PBKDF2_ITERATIONS,
            verificationToken: token,
            keyVersion: env.keyVersion || CURRENT_ENCRYPTION_KEY_VERSION,
            verifiedAtMs: Date.now(),
          };

          SessionKeyStore.setSessionKey(candidateKey, normalized, verifiedConfig);
          await this.persistProtectedKey(candidateKey, verifiedConfig);
          this.setStatus('UNLOCKED', null);
          return {
            success: true,
            masterKey: candidateKey,
            masterKeyHex: candidateKey.toString('hex'),
            config: verifiedConfig,
            status: 'UNLOCKED',
          };
        } else {
          if (env.encryptedDek) {
            hadAuthFailure = true;
          }
        }
      }

      // 3. Fallback: if no envelopes and no config with verification token (new/clean state)
      if (parsedEnvelopes.length === 0 && (!activeConfig || !activeConfig.verificationToken)) {
        const saltHex =
          activeConfig?.kdfSalt ||
          Buffer.from(getRandomBytes(SALT_LENGTH_BYTES)).toString('hex');
        let masterKey: Buffer;
        if (format === 'hex') {
          masterKey = Buffer.from(trimmed, 'hex');
        } else {
          masterKey = await deriveMasterKeyAsync(normalized, saltHex, PBKDF2_ITERATIONS);
        }
        let verificationToken: string;
        try {
          verificationToken = await createVerificationTokenAsync(masterKey);
        } catch {
          verificationToken = createVerificationToken(masterKey);
        }
        const newConfig: EncryptionConfig = {
          enabled: true,
          kdfSalt: saltHex,
          kdfIterations: PBKDF2_ITERATIONS,
          verificationToken,
          keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
          verifiedAtMs: Date.now(),
        };

        SessionKeyStore.setSessionKey(masterKey, normalized, newConfig);
        await this.persistProtectedKey(masterKey, newConfig);
        this.setStatus('UNLOCKED', null);
        return {
          success: true,
          masterKey,
          masterKeyHex: masterKey.toString('hex'),
          config: newConfig,
          status: 'UNLOCKED',
        };
      }

      this.setStatus('LOCKED', 'Authentication failed');

      if (hadAuthFailure || activeConfig?.verificationToken) {
        return {
          success: false,
          status: 'LOCKED',
          errorCode: 'INVALID_PASSPHRASE',
          errorMessage: 'Incorrect recovery passphrase. Authentication tag mismatch.',
        };
      }

      return {
        success: false,
        status: 'LOCKED',
        errorCode: 'INVALID_PASSPHRASE',
        errorMessage: 'Incorrect recovery passphrase. Verification failed.',
      };
    } catch (err: any) {
      this.setStatus('LOCKED', err?.message);
      return {
        success: false,
        status: 'LOCKED',
        errorCode: 'STORAGE_ERROR',
        errorMessage: `Unlock failed: ${err?.message || 'Unknown error'}`,
      };
    }
  }
}

export const UnifiedEncryptionService = new UnifiedEncryptionServiceManager();


