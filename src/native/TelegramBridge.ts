import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import {
  TelegramAuthState,
  TelegramBackupChannels,
  PocSuiteResult,
  TelegramHistoryItem,
} from '../types/telegram';

interface TelegramBridgeNativeModule {
  initialize(apiId: number, apiHash: string): Promise<boolean>;
  getAuthState(): Promise<TelegramAuthState>;
  sendPhoneNumber(phoneNumber: string): Promise<boolean>;
  sendAuthCode(code: string): Promise<boolean>;
  sendPassword(password: string): Promise<boolean>;
  logOut(): Promise<boolean>;
  setupChannels(): Promise<TelegramBackupChannels>;
  runPocTest(): Promise<PocSuiteResult>;
  getChannelHistory(
    chatId: string,
    limit: number,
    fromMessageId: string,
  ): Promise<TelegramHistoryItem[]>;
}

const { TelegramBridge } = NativeModules;

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
  }),
  runPocTest: async () => ({
    success: true,
    totalSteps: 10,
    passedSteps: 10,
    steps: [
      {
        step: 1,
        name: 'TDLib Storage Initialization',
        passed: true,
        message: 'Verified',
        durationMs: 40,
      },
      {
        step: 2,
        name: 'Telegram Authorization Check',
        passed: true,
        message: 'Ready',
        durationMs: 15,
      },
      {
        step: 3,
        name: 'Private Backup Channels Setup',
        passed: true,
        message: 'Verified',
        durationMs: 250,
      },
      {
        step: 4,
        name: 'Test Media Preparation',
        passed: true,
        message: 'Prepared',
        durationMs: 30,
      },
      {
        step: 5,
        name: 'Metadata Envelope Generation',
        passed: true,
        message: 'Generated',
        durationMs: 5,
      },
      {
        step: 6,
        name: 'Media Upload with Metadata',
        passed: true,
        message: 'Uploaded',
        durationMs: 420,
      },
      {
        step: 7,
        name: 'Channel History Read & Reconstruction',
        passed: true,
        message: 'Reconstructed',
        durationMs: 180,
      },
      {
        step: 8,
        name: 'Transfer Idempotency Reconciliation',
        passed: true,
        message: 'Reconciled',
        durationMs: 90,
      },
      {
        step: 9,
        name: 'Media Download & Verification',
        passed: true,
        message: 'Verified',
        durationMs: 310,
      },
      {
        step: 10,
        name: 'Temporary File Cleanup',
        passed: true,
        message: 'Cleaned',
        durationMs: 10,
      },
    ],
  }),
  getChannelHistory: async () => [],
};

const nativeModule: TelegramBridgeNativeModule =
  Platform.OS === 'android' && TelegramBridge ? TelegramBridge : fallbackMock;

export const TelegramBridgeService = {
  initialize: (apiId: number, apiHash: string) =>
    nativeModule.initialize(apiId, apiHash),
  getAuthState: () => nativeModule.getAuthState(),
  sendPhoneNumber: (phoneNumber: string) =>
    nativeModule.sendPhoneNumber(phoneNumber),
  sendAuthCode: (code: string) => nativeModule.sendAuthCode(code),
  sendPassword: (password: string) => nativeModule.sendPassword(password),
  logOut: () => nativeModule.logOut(),
  setupChannels: () => nativeModule.setupChannels(),
  runPocTest: () => nativeModule.runPocTest(),
  getChannelHistory: (
    chatId: string,
    limit: number = 50,
    fromMessageId: string = '0',
  ) => nativeModule.getChannelHistory(chatId, limit, fromMessageId),

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
