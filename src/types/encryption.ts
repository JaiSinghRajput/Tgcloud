export type EncryptionAlgorithm = 'AES-256-GCM';
export type KdfAlgorithm = 'PBKDF2-HMAC-SHA256';

export interface EncryptionConfig {
  enabled: boolean;
  kdfSalt: string;
  kdfIterations: number;
  verificationToken: string;
  keyVersion: number;
  verifiedAtMs: number;
}

export interface EncryptedItemEnvelope {
  alg: EncryptionAlgorithm;
  keyVersion: number;
  iv: string; // Base64
  tag: string; // Base64
  encryptedDek: string; // Base64
  dekIv: string; // Base64
  dekTag: string; // Base64
  encryptedMeta?: string; // Base64
  metaIv?: string; // Base64
  metaTag?: string; // Base64
  salt?: string; // Hex salt for PBKDF2 key derivation
  verificationToken?: string;
}

export interface SensitiveMediaMetadata {
  originalName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAtMs: number;
  contentHash?: string | null;
}

export interface RecoveryKeySetup {
  recoveryKey: string;
  config: EncryptionConfig;
  masterKeyHex: string;
}

export interface VerifyKeyResult {
  valid: boolean;
  masterKeyHex?: string;
  errorMessage?: string;
}
