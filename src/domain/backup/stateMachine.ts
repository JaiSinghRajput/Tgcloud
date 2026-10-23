/**
 * Central State Machine definition for Media Item lifecycle,
 * upload jobs, and retry policies as defined in BACKUP_STATE_MACHINE.md.
 */

export enum MediaState {
  DISCOVERED = 'Discovered',
  EXCLUDED = 'Excluded',
  QUEUED = 'Queued',
  WAITING_FOR_NETWORK = 'WaitingForNetwork',
  UPLOADING = 'Uploading',
  VERIFYING = 'Verifying',
  BACKED_UP = 'BackedUp',
  RETRY_PENDING = 'RetryPending',
  CHANGED = 'Changed',
  PERMISSION_REQUIRED = 'PermissionRequired',
  SOURCE_UNAVAILABLE = 'SourceUnavailable',
  AUTH_REQUIRED = 'AuthRequired',
  PERMANENT_FAILURE = 'PermanentFailure',
  CLOUD_MISSING = 'CloudMissing',
  REPAIR_QUEUED = 'RepairQueued',
}

export enum UploadJobState {
  PENDING = 'Pending',
  CLAIMED = 'Claimed',
  RUNNING = 'Running',
  VERIFYING = 'Verifying',
  COMPLETED = 'Completed',
  FAILED_RETRYABLE = 'FailedRetryable',
  FAILED_PERMANENT = 'FailedPermanent',
  CANCELLED = 'Cancelled',
}

export enum RestoreJobState {
  PENDING = 'Pending',
  DOWNLOADING = 'Downloading',
  VERIFYING = 'Verifying',
  RESTORING = 'Restoring',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
}

export enum ConflictPolicy {
  SKIP = 'skip',
  KEEP_BOTH = 'keep_both',
  REPLACE = 'replace',
}

export enum NetworkPolicy {
  WIFI_ONLY = 'wifi_only',
  WIFI_AND_CELLULAR = 'wifi_and_cellular',
}

/**
 * Valid media state transition map.
 */
const VALID_MEDIA_TRANSITIONS: Record<MediaState, ReadonlySet<MediaState>> = {
  [MediaState.DISCOVERED]: new Set([
    MediaState.EXCLUDED,
    MediaState.QUEUED,
    MediaState.PERMISSION_REQUIRED,
    MediaState.SOURCE_UNAVAILABLE,
    MediaState.CHANGED,
  ]),
  [MediaState.EXCLUDED]: new Set([MediaState.DISCOVERED, MediaState.QUEUED]),
  [MediaState.QUEUED]: new Set([
    MediaState.WAITING_FOR_NETWORK,
    MediaState.UPLOADING,
    MediaState.EXCLUDED,
    MediaState.PERMISSION_REQUIRED,
    MediaState.SOURCE_UNAVAILABLE,
    MediaState.AUTH_REQUIRED,
    MediaState.PERMANENT_FAILURE,
  ]),
  [MediaState.WAITING_FOR_NETWORK]: new Set([
    MediaState.QUEUED,
    MediaState.UPLOADING,
    MediaState.AUTH_REQUIRED,
    MediaState.PERMISSION_REQUIRED,
  ]),
  [MediaState.UPLOADING]: new Set([
    MediaState.VERIFYING,
    MediaState.BACKED_UP, // Post-crash reconciliation when upload was confirmed remotely
    MediaState.QUEUED, // Post-crash reconciliation when resetting stale upload
    MediaState.RETRY_PENDING,
    MediaState.PERMISSION_REQUIRED,
    MediaState.SOURCE_UNAVAILABLE,
    MediaState.AUTH_REQUIRED,
    MediaState.PERMANENT_FAILURE,
  ]),
  [MediaState.VERIFYING]: new Set([
    MediaState.BACKED_UP,
    MediaState.QUEUED, // Post-crash reconciliation when resetting stale verification
    MediaState.RETRY_PENDING,
    MediaState.PERMANENT_FAILURE,
  ]),
  [MediaState.BACKED_UP]: new Set([
    MediaState.CHANGED,
    MediaState.CLOUD_MISSING,
    MediaState.EXCLUDED,
    MediaState.DISCOVERED,
  ]),
  [MediaState.RETRY_PENDING]: new Set([
    MediaState.QUEUED,
    MediaState.WAITING_FOR_NETWORK,
    MediaState.AUTH_REQUIRED,
    MediaState.PERMANENT_FAILURE,
  ]),
  [MediaState.CHANGED]: new Set([MediaState.QUEUED, MediaState.EXCLUDED]),
  [MediaState.PERMISSION_REQUIRED]: new Set([
    MediaState.DISCOVERED,
    MediaState.QUEUED,
  ]),
  [MediaState.SOURCE_UNAVAILABLE]: new Set([
    MediaState.DISCOVERED,
    MediaState.QUEUED,
  ]),
  [MediaState.AUTH_REQUIRED]: new Set([
    MediaState.QUEUED,
    MediaState.WAITING_FOR_NETWORK,
  ]),
  [MediaState.PERMANENT_FAILURE]: new Set([
    MediaState.QUEUED, // Manual retry by user
  ]),
  [MediaState.CLOUD_MISSING]: new Set([
    MediaState.REPAIR_QUEUED,
    MediaState.EXCLUDED,
  ]),
  [MediaState.REPAIR_QUEUED]: new Set([
    MediaState.UPLOADING,
    MediaState.WAITING_FOR_NETWORK,
  ]),
};

export function isValidMediaTransition(
  from: MediaState,
  to: MediaState,
): boolean {
  if (from === to) return true;
  const allowed = VALID_MEDIA_TRANSITIONS[from];
  return allowed ? allowed.has(to) : false;
}

export function assertMediaTransition(from: MediaState, to: MediaState): void {
  if (!isValidMediaTransition(from, to)) {
    throw new Error(`Illegal media state transition from '${from}' to '${to}'`);
  }
}

/**
 * Calculates exponential backoff with jitter for retries.
 */
export function calculateNextRetryDelay(
  attemptCount: number,
  baseDelayMs: number = 2000,
  maxDelayMs: number = 300_000,
): number {
  if (attemptCount <= 0) return 0;
  // 2^(attempt-1) * baseDelay
  const expFactor = Math.pow(2, Math.min(attemptCount - 1, 8));
  const calculated = baseDelayMs * expFactor;
  // Apply jitter +/- 20%
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.min(Math.round(calculated * jitter), maxDelayMs);
}

/**
 * Determines whether an error code represents a transient or permanent error.
 */
export function isTransientError(errorCode?: string | null): boolean {
  if (!errorCode) return true;
  const upper = errorCode.toUpperCase();
  if (
    upper.includes('NETWORK') ||
    upper.includes('TIMEOUT') ||
    upper.includes('FLOOD_WAIT') ||
    upper.includes('500') ||
    upper.includes('502') ||
    upper.includes('503') ||
    upper.includes('429') ||
    upper.includes('RETRY')
  ) {
    return true;
  }
  return false;
}

/**
 * Generates an idempotency key for upload jobs to avoid duplicate jobs for identical file versions.
 */
export function generateUploadIdempotencyKey(
  mediaId: string,
  versionNumber: number,
  contentHash?: string | null,
): string {
  return `${mediaId}:v${versionNumber}:${contentHash || 'nohash'}`;
}

/**
 * Extracts flood wait seconds from a Telegram rate-limit error message (e.g. 420 FLOOD_WAIT_30).
 */
export function parseFloodWaitSeconds(errorMessage?: string | null): number | null {
  if (!errorMessage) return null;
  const match =
    errorMessage.match(/FLOOD_WAIT_(\d+)/i) ||
    errorMessage.match(/flood wait.*?(\d+)/i) ||
    errorMessage.match(/retry after (\d+)/i);
  if (match && match[1]) {
    const sec = parseInt(match[1], 10);
    return isNaN(sec) ? null : sec;
  }
  return null;
}

/**
 * Persists flood wait resume timestamp into database repository.
 */
export async function persistFloodWaitState(
  repo: { setSetting: (key: string, val: string) => Promise<void> },
  waitSeconds: number,
): Promise<number> {
  const resumeAtMs = Date.now() + waitSeconds * 1000;
  await repo.setSetting('telegram_flood_wait_until', String(resumeAtMs));
  return resumeAtMs;
}

/**
 * Checks whether Telegram flood wait is currently active.
 */
export async function isFloodWaitActive(
  repo: { getSetting: (key: string) => Promise<string | null> },
): Promise<boolean> {
  const waitVal = await repo.getSetting('telegram_flood_wait_until');
  if (!waitVal) return false;
  const waitUntil = parseInt(waitVal, 10);
  return !isNaN(waitUntil) && waitUntil > Date.now();
}

/**
 * Returns remaining flood wait seconds if active, or 0 if inactive.
 */
export async function getPersistedFloodWaitSeconds(
  repo: { getSetting: (key: string) => Promise<string | null> },
): Promise<number> {
  const waitVal = await repo.getSetting('telegram_flood_wait_until');
  if (!waitVal) return 0;
  const waitUntil = parseInt(waitVal, 10);
  if (isNaN(waitUntil) || waitUntil <= Date.now()) return 0;
  return Math.ceil((waitUntil - Date.now()) / 1000);
}


