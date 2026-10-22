import { EncryptedItemEnvelope } from './encryption';

export type TelegramAuthStateType =
  | 'UNINITIALIZED'
  | 'WAIT_PARAMETERS'
  | 'WAIT_PHONE_NUMBER'
  | 'WAIT_CODE'
  | 'WAIT_PASSWORD'
  | 'READY'
  | 'LOGGING_OUT'
  | 'CLOSED'
  | 'ERROR';

export interface TelegramAuthState {
  state: TelegramAuthStateType;
  userId?: number;
  firstName?: string;
  lastName?: string;
  isRegistered?: boolean;
  timeout?: number;
  hint?: string;
  code?: number;
  message?: string;
}

export type DestinationLifecycleState =
  | 'CONNECTED'
  | 'CHECKING'
  | 'UNREACHABLE'
  | 'ACCESS_REVOKED'
  | 'DELETED'
  | 'NEEDS_SETUP'
  | 'RECREATED';

export interface DestinationStatus {
  channelId: string;
  title: string;
  state: DestinationLifecycleState;
  errorMessage?: string;
}

export interface TelegramBackupChannels {
  photoChannelId: string;
  photoChannelTitle: string;
  videoChannelId: string;
  videoChannelTitle: string;
  verified: boolean;
  photoStatus?: DestinationStatus;
  videoStatus?: DestinationStatus;
}

export interface TelegramMetadataEnvelope {
  schemaVersion: number;
  app: string;
  mediaId: string;
  mediaType: 'photo' | 'video';
  originalName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAtMs: number;
  contentHash?: string | null;
  encryptionEnvelope?: EncryptedItemEnvelope | string | null;
}

export interface PocStepResult {
  step: number;
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

export interface PocSuiteResult {
  success: boolean;
  totalSteps: number;
  passedSteps: number;
  steps: PocStepResult[];
}

export interface TelegramHistoryItem {
  messageId: string;
  chatId: string;
  fileId: number;
  mediaId: string;
  mediaType: 'photo' | 'video';
  originalName: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  contentHash?: string;
  date: number;
  encryptionEnvelope?: EncryptedItemEnvelope | string | null;
}
