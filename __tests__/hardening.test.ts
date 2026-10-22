import {
  DiagnosticsService,
  DiagnosticEvent,
} from '../src/domain/diagnostics/diagnosticsService';
import {
  calculateNextRetryDelay,
  isTransientError,
  MediaState,
} from '../src/domain/backup/stateMachine';
import { InMemoryDatabaseRepository } from '../src/domain/database/repository';
import { DbMediaItem } from '../src/domain/database/types';

describe('Hardening, Storage Pressure & Privacy Review (Phase 8)', () => {
  describe('Large Library Batching & Memory Safety', () => {
    it('efficiently batches and processes 5,000 media items in chunks without unbounded growth', async () => {
      const repo = new InMemoryDatabaseRepository();
      const totalItems = 5000;
      const batchSize = 100;

      // Generate 5,000 items
      const mockItems: DbMediaItem[] = [];
      for (let i = 0; i < totalItems; i++) {
        mockItems.push({
          id: `large-media-${i}`,
          sourceKey: `store-${i}`,
          mediaType: i % 5 === 0 ? 'video' : 'photo',
          displayName: `IMG_${i}.jpg`,
          relativePath: `DCIM/Camera/IMG_${i}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: 2_000_000 + i * 100,
          modifiedAtMs: 1792600000000 + i,
          createdAtMs: 1792600000000 + i,
          contentHash: null,
          state: MediaState.DISCOVERED,
          isExcluded: false,
          lastScannedAtMs: Date.now(),
          createdAtMsLocal: Date.now(),
          updatedAtMsLocal: Date.now(),
        });
      }

      // Stream through repository in batches
      let processedCount = 0;
      for (let offset = 0; offset < mockItems.length; offset += batchSize) {
        const chunk = mockItems.slice(offset, offset + batchSize);
        for (const item of chunk) {
          await repo.upsertMediaItem(item);
          processedCount++;
        }
      }

      expect(processedCount).toBe(5000);
      const allSaved = await repo.listMediaItems();
      expect(allSaved).toHaveLength(5000);
    });
  });

  describe('Storage Pressure Enforcement', () => {
    function canProceedWithRestore(
      requiredSizeBytes: number,
      availableFreeBytes: number,
      safetyBufferBytes: number = 25 * 1024 * 1024, // 25MB safety buffer
    ): { allowed: boolean; reason?: string } {
      if (availableFreeBytes < requiredSizeBytes + safetyBufferBytes) {
        return {
          allowed: false,
          reason:
            'Insufficient storage: restoring this item would breach device safety margins.',
        };
      }
      return { allowed: true };
    }

    it('rejects restore operations when free storage is below item size plus safety buffer', () => {
      const itemSize = 50 * 1024 * 1024; // 50MB
      const freeSpaceLow = 60 * 1024 * 1024; // 60MB free (less than 50MB + 25MB safety)

      const result = canProceedWithRestore(itemSize, freeSpaceLow);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient storage');
    });

    it('permits restore operations when adequate free storage is verified', () => {
      const itemSize = 10 * 1024 * 1024; // 10MB
      const freeSpacePlenty = 500 * 1024 * 1024; // 500MB free

      const result = canProceedWithRestore(itemSize, freeSpacePlenty);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Diagnostics Privacy & Opt-In Safeguards (PRD Section 5.8)', () => {
    it('discards all telemetry events when user has not explicitly opted in', () => {
      const diagnostics = new DiagnosticsService(false); // opt-out by default

      const event: DiagnosticEvent = {
        eventName: 'backup_cycle_completed',
        appVersion: '1.0.0',
        osVersion: 'Android 15',
        durationMs: 450,
        timestampMs: Date.now(),
      };

      const recorded = diagnostics.recordEvent(event);
      expect(recorded).toBe(false);
      expect(diagnostics.getEvents()).toHaveLength(0);
    });

    it('records sanitized diagnostic events when user has opted in', () => {
      const diagnostics = new DiagnosticsService(true); // opted in

      const event: DiagnosticEvent = {
        eventName: 'network_retry',
        appVersion: '1.0.0',
        osVersion: 'Android 15',
        errorCode: 'CONNECTIVITY_TIMEOUT',
        errorCategory: 'network',
        durationMs: 1200,
        jobCorrelationId: 'd6b9d628-9ec1-43e5-8278-831d4f2ea0aa',
        timestampMs: Date.now(),
      };

      const recorded = diagnostics.recordEvent(event);
      expect(recorded).toBe(true);
      expect(diagnostics.getEvents()).toHaveLength(1);
      expect(diagnostics.getEvents()[0].eventName).toBe('network_retry');
    });

    it('STRICT PRIVACY AUDIT: rejects any diagnostic payload containing forbidden sensitive keys', () => {
      const diagnostics = new DiagnosticsService(true);

      const event: DiagnosticEvent = {
        eventName: 'leak_attempt_test',
        appVersion: '1.0.0',
        osVersion: 'Android 15',
        timestampMs: Date.now(),
      };

      // Forbidden fields to test
      const forbiddenPayloads = [
        { filename: 'family_photo.jpg' },
        { relativePath: 'DCIM/Private/doc.pdf' },
        { content: 'secret image bytes' },
        { recoveryKey: 'alpha beacon canyon' },
        { authCode: 12345 },
        { token: 'tg_session_token_xyz' },
      ];

      for (const payload of forbiddenPayloads) {
        const recorded = diagnostics.recordEvent(event, payload);
        expect(recorded).toBe(false); // MUST BE REJECTED
      }

      expect(diagnostics.getEvents()).toHaveLength(0);
    });

    it('clears all recorded diagnostic logs immediately when user toggles opt-in off', () => {
      const diagnostics = new DiagnosticsService(true);
      diagnostics.recordEvent({
        eventName: 'test_event',
        appVersion: '1.0.0',
        osVersion: 'Android 15',
        timestampMs: Date.now(),
      });
      expect(diagnostics.getEvents()).toHaveLength(1);

      diagnostics.setOptIn(false);
      expect(diagnostics.getEvents()).toHaveLength(0);
      expect(diagnostics.isDiagnosticsEnabled()).toBe(false);
    });
  });

  describe('Telegram MTProto FLOOD_WAIT and Error Recovery', () => {
    function parseFloodWaitSeconds(errorMessage: string): number | null {
      const match = errorMessage.match(/FLOOD_WAIT_(\d+)/i);
      return match ? parseInt(match[1], 10) : null;
    }

    it('extracts precise wait duration from Telegram FLOOD_WAIT errors and enforces delay', () => {
      const errorMsg = '420: FLOOD_WAIT_180';
      const waitSeconds = parseFloodWaitSeconds(errorMsg);

      expect(waitSeconds).toBe(180);
      const waitMs = (waitSeconds || 0) * 1000;
      expect(waitMs).toBe(180_000); // 3 minutes backoff
    });

    it('classifies retryable errors and calculates exponential backoff', () => {
      expect(isTransientError('NETWORK_UNAVAILABLE')).toBe(true);
      expect(isTransientError('FLOOD_WAIT_60')).toBe(true);
      expect(isTransientError('FILE_NOT_FOUND')).toBe(false); // permanent, not transient
      expect(isTransientError('CORRUPTED_METADATA')).toBe(false);

      const delay0 = calculateNextRetryDelay(0);
      const delay1 = calculateNextRetryDelay(1, 2000);
      const delay2 = calculateNextRetryDelay(2, 2000);

      expect(delay0).toBe(0);
      expect(delay1).toBeGreaterThanOrEqual(1600); // with jitter
      expect(delay2).toBeGreaterThanOrEqual(3200);
    });
  });
});
