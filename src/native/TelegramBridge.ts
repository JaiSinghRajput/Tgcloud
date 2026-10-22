import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { Buffer } from 'buffer';
import {
  TelegramAuthState,
  TelegramBackupChannels,
  PocSuiteResult,
  TelegramHistoryItem,
} from '../types/telegram';

if (typeof global !== 'undefined' && typeof (global as any).Buffer === 'undefined') {
  (global as any).Buffer = Buffer;
}

export interface EncryptedPayloadResult {
  ciphertextBase64: string;
  ivBase64: string;
  tagBase64: string;
}

export interface PreparedVideoResult {
  localUri: string;
  tempFilePath: string;
  isTemporary: boolean;
}

interface TelegramBridgeNativeModule {
  initialize(apiId: number, apiHash: string): Promise<boolean>;
  getAuthState(): Promise<TelegramAuthState>;
  sendPhoneNumber(phoneNumber: string): Promise<boolean>;
  sendAuthCode(code: string): Promise<boolean>;
  sendPassword(password: string): Promise<boolean>;
  logOut(): Promise<boolean>;
  setupChannels(): Promise<TelegramBackupChannels>;
  refreshDestinations(): Promise<TelegramBackupChannels | null>;
  createDestination(destinationType: string): Promise<{ channelId: string; title: string }>;
  recreateDestination(destinationType: string): Promise<{ channelId: string; title: string }>;
  reconnectDestination(channelId: string): Promise<boolean>;
  runPocTest(): Promise<PocSuiteResult>;
  getChannelHistory(
    chatId: string,
    limit: number,
    fromMessageId: string,
  ): Promise<TelegramHistoryItem[]>;
  openChatInTelegram(chatId: string): Promise<boolean>;

  // Cryptography
  deriveMasterKey(
    recoveryKey: string,
    saltHex: string,
    iterations?: number,
  ): Promise<string>;
  createVerificationToken(masterKeyHex: string): Promise<string>;
  verifyRecoveryKey(
    recoveryKey: string,
    saltHex: string,
    verificationTokenJson: string,
  ): Promise<boolean>;
  encryptPayload(
    plaintextBase64: string,
    keyHex: string,
  ): Promise<EncryptedPayloadResult>;
  decryptPayload(
    ciphertextBase64: string,
    keyHex: string,
    ivBase64: string,
    tagBase64: string,
  ): Promise<string>;

  // Video playback
  playVideo(uriString: string): Promise<boolean>;
  prepareCloudVideo(
    fileId: number,
    isEncrypted: boolean,
    envelopeJson: string,
    masterKeyHex: string,
  ): Promise<PreparedVideoResult>;
  cleanupTempMedia(filePath: string): Promise<boolean>;
}

const { TelegramBridge } = NativeModules;

// Dynamic crypto for Jest / Node.js test environment
const getNodeCrypto = (): any => {
  try {
    const mod = 'cry' + 'pto';
    return typeof require !== 'undefined' ? require(mod) : null;
  } catch {
    return null;
  }
};
const nodeCrypto = getNodeCrypto();

// Test environment / fallback mock for Jest and non-Android environments
const fallbackMock: TelegramBridgeNativeModule = {
  initialize: async () => true,
  getAuthState: async () => ({
    state: 'READY',
    userId: 12345678,
    firstName: 'Test',
    lastName: 'User',
  }),
  sendPhoneNumber: async () => true,
  sendAuthCode: async () => true,
  sendPassword: async () => true,
  logOut: async () => true,
  setupChannels: async () => ({
    photoChannelId: '-1001234567890',
    photoChannelTitle: 'Backup - Photos',
    videoChannelId: '-1001234567891',
    videoChannelTitle: 'Backup - Videos',
    verified: true,
    photoStatus: {
      channelId: '-1001234567890',
      title: 'Backup - Photos',
      state: 'CONNECTED',
    },
    videoStatus: {
      channelId: '-1001234567891',
      title: 'Backup - Videos',
      state: 'CONNECTED',
    },
  }),
  refreshDestinations: async () => ({
    photoChannelId: '-1001234567890',
    photoChannelTitle: 'Backup - Photos',
    videoChannelId: '-1001234567891',
    videoChannelTitle: 'Backup - Videos',
    verified: true,
    photoStatus: {
      channelId: '-1001234567890',
      title: 'Backup - Photos',
      state: 'CONNECTED',
    },
    videoStatus: {
      channelId: '-1001234567891',
      title: 'Backup - Videos',
      state: 'CONNECTED',
    },
  }),
  createDestination: async (type: string) => ({
    channelId: type === 'photo' ? '-1001234567890' : '-1001234567891',
    title: type === 'photo' ? 'Backup - Photos' : 'Backup - Videos',
  }),
  recreateDestination: async (type: string) => ({
    channelId: type === 'photo' ? '-1001234567898' : '-1001234567899',
    title: type === 'photo' ? 'Backup - Photos' : 'Backup - Videos',
  }),
  reconnectDestination: async () => true,
  runPocTest: async () => ({
    success: true,
    totalSteps: 10,
    passedSteps: 10,
    steps: [
      { step: 1, name: 'TDLib Storage Initialization', passed: true, message: 'Verified', durationMs: 40 },
      { step: 2, name: 'Telegram Authorization Check', passed: true, message: 'Ready', durationMs: 15 },
      { step: 3, name: 'Private Backup Channels Setup', passed: true, message: 'Verified', durationMs: 250 },
      { step: 4, name: 'Test Media Preparation', passed: true, message: 'Prepared', durationMs: 30 },
      { step: 5, name: 'Metadata Envelope Generation', passed: true, message: 'Generated', durationMs: 5 },
      { step: 6, name: 'Media Upload with Metadata', passed: true, message: 'Uploaded', durationMs: 420 },
      { step: 7, name: 'Channel History Read & Reconstruction', passed: true, message: 'Reconstructed', durationMs: 180 },
      { step: 8, name: 'Transfer Idempotency Reconciliation', passed: true, message: 'Reconciled', durationMs: 90 },
      { step: 9, name: 'Media Download & Verification', passed: true, message: 'Verified', durationMs: 310 },
      { step: 10, name: 'Temporary File Cleanup', passed: true, message: 'Cleaned', durationMs: 10 },
    ],
  }),
  getChannelHistory: async () => [],
  openChatInTelegram: async () => true,

  deriveMasterKey: async (recoveryKey: string, saltHex: string, iterations = 100000) => {
    if (nodeCrypto?.pbkdf2Sync) {
      const normalized = recoveryKey.trim().toLowerCase().replace(/\s+/g, ' ');
      const salt = Buffer.from(saltHex, 'hex');
      const key = nodeCrypto.pbkdf2Sync(normalized, salt, iterations, 32, 'sha256');
      return key.toString('hex');
    }
    return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  },

  createVerificationToken: async (masterKeyHex: string) => {
    if (nodeCrypto?.createCipheriv) {
      const key = Buffer.from(masterKeyHex, 'hex');
      const iv = Buffer.from(nodeCrypto.randomBytes(12));
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
      const plaintext = Buffer.from('TGB_RECOVERY_KEY_VERIFIED_V1', 'utf8');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return JSON.stringify({
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ct: ciphertext.toString('base64'),
      });
    }
    return JSON.stringify({ iv: 'mockIv', tag: 'mockTag', ct: 'mockCt' });
  },

  verifyRecoveryKey: async (recoveryKey: string, saltHex: string, verificationTokenJson: string) => {
    try {
      if (nodeCrypto?.createDecipheriv && nodeCrypto?.pbkdf2Sync) {
        const normalized = recoveryKey.trim().toLowerCase().replace(/\s+/g, ' ');
        const salt = Buffer.from(saltHex, 'hex');
        const masterKey = nodeCrypto.pbkdf2Sync(normalized, salt, 100000, 32, 'sha256');
        const tokenObj = JSON.parse(verificationTokenJson);
        const decipher = nodeCrypto.createDecipheriv(
          'aes-256-gcm',
          masterKey,
          Buffer.from(tokenObj.iv, 'base64'),
        );
        decipher.setAuthTag(Buffer.from(tokenObj.tag, 'base64'));
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(tokenObj.ct, 'base64')),
          decipher.final(),
        ]);
        return decrypted.toString('utf8') === 'TGB_RECOVERY_KEY_VERIFIED_V1';
      }
      return true;
    } catch {
      return false;
    }
  },

  encryptPayload: async (plaintextBase64: string, keyHex: string) => {
    if (nodeCrypto?.createCipheriv) {
      const key = Buffer.from(keyHex, 'hex');
      const iv = Buffer.from(nodeCrypto.randomBytes(12));
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
      const plaintext = Buffer.from(plaintextBase64, 'base64');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        ciphertextBase64: ciphertext.toString('base64'),
        ivBase64: iv.toString('base64'),
        tagBase64: tag.toString('base64'),
      };
    }
    return {
      ciphertextBase64: plaintextBase64,
      ivBase64: 'mockIv',
      tagBase64: 'mockTag',
    };
  },

  decryptPayload: async (ciphertextBase64: string, keyHex: string, ivBase64: string, tagBase64: string) => {
    if (nodeCrypto?.createDecipheriv) {
      const key = Buffer.from(keyHex, 'hex');
      const decipher = nodeCrypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivBase64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertextBase64, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('base64');
    }
    return ciphertextBase64;
  },

  playVideo: async () => true,
  prepareCloudVideo: async (fileId: number) => ({
    localUri: `file:///data/user/0/mock_video_${fileId}.mp4`,
    tempFilePath: `/data/user/0/mock_video_${fileId}.mp4`,
    isTemporary: false,
  }),
  cleanupTempMedia: async () => true,
};

const nativeModule: TelegramBridgeNativeModule =
  Platform.OS === 'android' && TelegramBridge ? TelegramBridge : fallbackMock;

export const DEFAULT_TELEGRAM_API_ID = 2040;
export const DEFAULT_TELEGRAM_API_HASH = 'b18441a1ff607e10a989891a5462e627';

export const TelegramBridgeService = {
  initialize: (
    apiId: number = DEFAULT_TELEGRAM_API_ID,
    apiHash: string = DEFAULT_TELEGRAM_API_HASH,
  ) => nativeModule.initialize(apiId, apiHash),
  getAuthState: () => nativeModule.getAuthState(),
  sendPhoneNumber: (phoneNumber: string) =>
    nativeModule.sendPhoneNumber(phoneNumber),
  sendAuthCode: (code: string) => nativeModule.sendAuthCode(code),
  sendPassword: (password: string) => nativeModule.sendPassword(password),
  logOut: () => nativeModule.logOut(),
  setupChannels: () => nativeModule.setupChannels(),
  refreshDestinations: () => nativeModule.refreshDestinations(),
  createDestination: (type: 'photo' | 'video') =>
    nativeModule.createDestination(type),
  recreateDestination: (type: 'photo' | 'video') =>
    nativeModule.recreateDestination(type),
  reconnectDestination: (channelId: string) =>
    nativeModule.reconnectDestination(channelId),
  runPocTest: () => nativeModule.runPocTest(),
  getChannelHistory: (
    chatId: string,
    limit: number = 50,
    fromMessageId: string = '0',
  ) => nativeModule.getChannelHistory(chatId, limit, fromMessageId),
  openChatInTelegram: (chatId: string) => nativeModule.openChatInTelegram(chatId),

  // Native Cryptography
  deriveMasterKey: (recoveryKey: string, saltHex: string, iterations?: number) =>
    nativeModule.deriveMasterKey(recoveryKey, saltHex, iterations),
  createVerificationToken: (masterKeyHex: string) =>
    nativeModule.createVerificationToken(masterKeyHex),
  verifyRecoveryKey: (
    recoveryKey: string,
    saltHex: string,
    verificationTokenJson: string,
  ) =>
    nativeModule.verifyRecoveryKey(recoveryKey, saltHex, verificationTokenJson),
  encryptPayload: (plaintextBase64: string, keyHex: string) =>
    nativeModule.encryptPayload(plaintextBase64, keyHex),
  decryptPayload: (
    ciphertextBase64: string,
    keyHex: string,
    ivBase64: string,
    tagBase64: string,
  ) => nativeModule.decryptPayload(ciphertextBase64, keyHex, ivBase64, tagBase64),

  // Video Playback
  playVideo: (uriString: string) => nativeModule.playVideo(uriString),
  prepareCloudVideo: (
    fileId: number,
    isEncrypted: boolean,
    envelopeJson: string,
    masterKeyHex: string,
  ) =>
    nativeModule.prepareCloudVideo(
      fileId,
      isEncrypted,
      envelopeJson,
      masterKeyHex,
    ),
  cleanupTempMedia: (filePath: string) =>
    nativeModule.cleanupTempMedia(filePath),

  subscribeToAuthState: (callback: (state: TelegramAuthState) => void) => {
    if (Platform.OS === 'android' && TelegramBridge) {
      const emitter = new NativeEventEmitter(TelegramBridge);
      const subscription = emitter.addListener(
        'onAuthStateChanged',
        (event: any) => {
          callback(event as TelegramAuthState);
        },
      );
      return () => subscription.remove();
    }
    return () => {};
  },
};
