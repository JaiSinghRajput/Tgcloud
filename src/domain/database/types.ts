import {
  MediaState,
  UploadJobState,
  RestoreJobState,
  ConflictPolicy,
} from '../backup/stateMachine';

export interface DbMediaItem {
  id: string;
  sourceKey?: string | null;
  mediaType: 'photo' | 'video';
  displayName: string;
  relativePath?: string | null;
  mimeType?: string | null;
  sizeBytes: number;
  modifiedAtMs: number;
  createdAtMs: number;
  contentHash?: string | null;
  state: MediaState;
  isExcluded: boolean;
  lastScannedAtMs: number;
  createdAtMsLocal: number;
  updatedAtMsLocal: number;
}

export interface DbTelegramObject {
  id: string;
  mediaItemId: string;
  channelId: string;
  messageId: string;
  remoteFileId?: string | null;
  metadataVersion: number;
  contentHash?: string | null;
  uploadedAtMs: number;
  verifiedAtMs: number;
  status: 'available' | 'missing' | 'verification_pending';
}

export interface DbUploadJob {
  id: string;
  mediaItemId: string;
  state: UploadJobState;
  attemptCount: number;
  nextAttemptAtMs?: number | null;
  lastErrorCode?: string | null;
  lastErrorSummary?: string | null;
  idempotencyKey: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DbFolderExclusion {
  id: string;
  folderKey: string;
  displayLabel?: string | null;
  createdAtMs: number;
}

export interface DbRestoreJob {
  id: string;
  telegramObjectId: string;
  destinationUri?: string | null;
  conflictPolicy: ConflictPolicy;
  state: RestoreJobState;
  attemptCount: number;
  lastErrorCode?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DashboardMetrics {
  totalDiscovered: number;
  pending: number;
  backedUp: number;
  uploading: number;
  failed: number;
  excluded: number;
  lastBackupTimeMs: number | null;
}
