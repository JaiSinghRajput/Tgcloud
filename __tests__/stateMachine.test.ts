import {
  MediaState,
  isValidMediaTransition,
  assertMediaTransition,
  calculateNextRetryDelay,
  isTransientError,
  generateUploadIdempotencyKey,
} from '../src/domain/backup/stateMachine';

describe('Backup State Machine & Retry Rules', () => {
  describe('Media State Transitions', () => {
    it('allows valid normal backup transitions: Discovered -> Queued -> Uploading -> Verifying -> BackedUp', () => {
      expect(
        isValidMediaTransition(MediaState.DISCOVERED, MediaState.QUEUED),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.QUEUED, MediaState.UPLOADING),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.UPLOADING, MediaState.VERIFYING),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.VERIFYING, MediaState.BACKED_UP),
      ).toBe(true);
    });

    it('allows transient failure and retry loop: Uploading -> RetryPending -> Queued', () => {
      expect(
        isValidMediaTransition(MediaState.UPLOADING, MediaState.RETRY_PENDING),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.RETRY_PENDING, MediaState.QUEUED),
      ).toBe(true);
    });

    it('allows waiting for network: Queued -> WaitingForNetwork -> Uploading', () => {
      expect(
        isValidMediaTransition(
          MediaState.QUEUED,
          MediaState.WAITING_FOR_NETWORK,
        ),
      ).toBe(true);
      expect(
        isValidMediaTransition(
          MediaState.WAITING_FOR_NETWORK,
          MediaState.UPLOADING,
        ),
      ).toBe(true);
    });

    it('allows folder exclusion from Discovered, Queued, and BackedUp', () => {
      expect(
        isValidMediaTransition(MediaState.DISCOVERED, MediaState.EXCLUDED),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.QUEUED, MediaState.EXCLUDED),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.BACKED_UP, MediaState.EXCLUDED),
      ).toBe(true);
    });

    it('allows Changed state when local file modification is detected', () => {
      expect(
        isValidMediaTransition(MediaState.BACKED_UP, MediaState.CHANGED),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.CHANGED, MediaState.QUEUED),
      ).toBe(true);
    });

    it('allows CloudMissing and RepairQueued flow', () => {
      expect(
        isValidMediaTransition(MediaState.BACKED_UP, MediaState.CLOUD_MISSING),
      ).toBe(true);
      expect(
        isValidMediaTransition(
          MediaState.CLOUD_MISSING,
          MediaState.REPAIR_QUEUED,
        ),
      ).toBe(true);
      expect(
        isValidMediaTransition(MediaState.REPAIR_QUEUED, MediaState.UPLOADING),
      ).toBe(true);
    });

    it('rejects invalid jumps such as Discovered -> BackedUp directly', () => {
      expect(
        isValidMediaTransition(MediaState.DISCOVERED, MediaState.BACKED_UP),
      ).toBe(false);
      expect(() =>
        assertMediaTransition(MediaState.DISCOVERED, MediaState.BACKED_UP),
      ).toThrow(/Illegal media state transition/);
    });

    it('rejects invalid jump from BackedUp directly to Uploading without Changed', () => {
      expect(
        isValidMediaTransition(MediaState.BACKED_UP, MediaState.UPLOADING),
      ).toBe(false);
    });
  });

  describe('Retry Backoff and Classification', () => {
    it('calculates exponential backoff with increasing attempts', () => {
      const delay1 = calculateNextRetryDelay(1, 1000, 60000);
      const delay2 = calculateNextRetryDelay(2, 1000, 60000);
      const delay3 = calculateNextRetryDelay(3, 1000, 60000);

      expect(delay1).toBeGreaterThanOrEqual(700);
      expect(delay2).toBeGreaterThanOrEqual(delay1);
      expect(delay3).toBeGreaterThanOrEqual(delay2);
    });

    it('caps retry delay at maxDelayMs', () => {
      const delay = calculateNextRetryDelay(20, 1000, 30000);
      expect(delay).toBeLessThanOrEqual(30000);
    });

    it('classifies network, timeout and flood wait as transient', () => {
      expect(isTransientError('NETWORK_TIMEOUT')).toBe(true);
      expect(isTransientError('FLOOD_WAIT_30')).toBe(true);
      expect(isTransientError('503_SERVICE_UNAVAILABLE')).toBe(true);
      expect(isTransientError('429_RATE_LIMIT')).toBe(true);
    });

    it('classifies auth and invalid file errors as permanent', () => {
      expect(isTransientError('AUTH_KEY_UNREGISTERED')).toBe(false);
      expect(isTransientError('FILE_PARTS_INVALID')).toBe(false);
      expect(isTransientError('SESSION_REVOKED')).toBe(false);
    });
  });

  describe('Idempotency Keys', () => {
    it('generates consistent unique idempotency key for media version', () => {
      const key1 = generateUploadIdempotencyKey('media-1', 1, 'hash-abc');
      const key2 = generateUploadIdempotencyKey('media-1', 1, 'hash-abc');
      const keyVersion2 = generateUploadIdempotencyKey(
        'media-1',
        2,
        'hash-xyz',
      );

      expect(key1).toBe('media-1:v1:hash-abc');
      expect(key1).toBe(key2);
      expect(key1).not.toBe(keyVersion2);
    });
  });
});
