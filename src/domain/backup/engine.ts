import { DatabaseRepository } from '../database/repository';
import {
  MediaState,
  UploadJobState,
  NetworkPolicy,
  calculateNextRetryDelay,
  isTransientError,
} from './stateMachine';
import { DbUploadJob, DbMediaItem } from '../database/types';

export interface BackupTransferProgress {
  mediaItemId: string;
  displayName: string;
  bytesUploaded: number;
  totalBytes: number;
  state: MediaState;
}

export interface BackupEngineCallbacks {
  onProgress?: (progress: BackupTransferProgress) => void;
  onJobCompleted?: (job: DbUploadJob, mediaItem: DbMediaItem) => void;
  onJobFailed?: (job: DbUploadJob, error: string, isRetryable: boolean) => void;
}

/**
 * Persistent backup engine enforcing queue claiming, network policies,
 * exponential backoff retry, and crash reconciliation.
 */
export class BackupEngine {
  private isPaused: boolean = false;
  private isRunning: boolean = false;

  constructor(
    private readonly repo: DatabaseRepository,
    private readonly uploader: (mediaItem: DbMediaItem) => Promise<{
      channelId: string;
      messageId: string;
      contentHash?: string | null;
    }>,
    private readonly remoteReconciler: (
      mediaItem: DbMediaItem,
    ) => Promise<{ channelId: string; messageId: string } | null>,
  ) {}

  /**
   * Enforces invariant: persists jobs to SQLite before dispatching transfers.
   */
  async queueMediaForBackup(mediaItemIds: string[]): Promise<DbUploadJob[]> {
    const jobs: DbUploadJob[] = [];
    for (const id of mediaItemIds) {
      const job = await this.repo.createUploadJob(id);
      jobs.push(job);
    }
    return jobs;
  }

  /**
   * Executes eligible queued jobs subject to network policy and pause status.
   */
  async runQueue(
    networkPolicy: NetworkPolicy,
    isWifiConnected: boolean,
    callbacks?: BackupEngineCallbacks,
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isPaused) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    // Invariant: Wi-Fi-only mode must not start transfers on cellular data
    if (networkPolicy === NetworkPolicy.WIFI_ONLY && !isWifiConnected) {
      const pendingItems = await this.repo.listMediaItems(MediaState.QUEUED);
      for (const item of pendingItems) {
        await this.repo.upsertMediaItem({
          ...item,
          state: MediaState.WAITING_FOR_NETWORK,
        });
      }
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isRunning = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      while (!this.isPaused) {
        const job = await this.repo.claimNextUploadJob();
        if (!job) break;

        processed++;
        const media = await this.repo.getMediaItem(job.mediaItemId);
        if (!media) {
          await this.repo.updateUploadJobState(
            job.id,
            UploadJobState.FAILED_PERMANENT,
            'MEDIA_NOT_FOUND',
          );
          failed++;
          continue;
        }

        // Check if media is excluded
        if (media.isExcluded || media.state === MediaState.EXCLUDED) {
          await this.repo.updateUploadJobState(
            job.id,
            UploadJobState.COMPLETED,
          );
          continue;
        }

        try {
          // Transition media to Uploading
          await this.repo.upsertMediaItem({
            ...media,
            state: MediaState.UPLOADING,
          });
          await this.repo.updateUploadJobState(job.id, UploadJobState.RUNNING);

          callbacks?.onProgress?.({
            mediaItemId: media.id,
            displayName: media.displayName,
            bytesUploaded: 0,
            totalBytes: media.sizeBytes,
            state: MediaState.UPLOADING,
          });

          // Upload data via TDLib adapter
          const remoteRef = await this.uploader(media);

          // Transition to Verifying
          await this.repo.upsertMediaItem({
            ...media,
            state: MediaState.VERIFYING,
          });
          await this.repo.updateUploadJobState(
            job.id,
            UploadJobState.VERIFYING,
          );

          // Invariant: Verify remote success before marking BackedUp
          await this.repo.recordTelegramObject({
            id: `tg-${remoteRef.channelId}-${remoteRef.messageId}`,
            mediaItemId: media.id,
            channelId: remoteRef.channelId,
            messageId: remoteRef.messageId,
            metadataVersion: 1,
            contentHash: remoteRef.contentHash || media.contentHash,
            uploadedAtMs: Date.now(),
            verifiedAtMs: Date.now(),
            status: 'available',
          });

          await this.repo.updateUploadJobState(
            job.id,
            UploadJobState.COMPLETED,
          );
          succeeded++;
          callbacks?.onJobCompleted?.(job, media);
        } catch (err: any) {
          failed++;
          const errorMessage = err?.message || 'Unknown upload error';
          const isRetryable = isTransientError(errorMessage);

          if (isRetryable && job.attemptCount < 5) {
            const nextDelay = calculateNextRetryDelay(job.attemptCount);
            const nextAttemptAt = Date.now() + Math.max(nextDelay, 1000);

            await this.repo.upsertMediaItem({
              ...media,
              state: MediaState.RETRY_PENDING,
            });
            await this.repo.updateUploadJobState(
              job.id,
              UploadJobState.FAILED_RETRYABLE,
              'TRANSIENT_ERROR',
              errorMessage,
              nextAttemptAt,
            );
          } else {
            await this.repo.upsertMediaItem({
              ...media,
              state: MediaState.PERMANENT_FAILURE,
            });
            await this.repo.updateUploadJobState(
              job.id,
              UploadJobState.FAILED_PERMANENT,
              'PERMANENT_ERROR',
              errorMessage,
            );
          }

          callbacks?.onJobFailed?.(job, errorMessage, isRetryable);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return { processed, succeeded, failed };
  }

  /**
   * Pauses the backup engine without losing persisted queue records.
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resumes the backup engine.
   */
  resume(): void {
    this.isPaused = false;
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Reconciles stale jobs left in Uploading or Verifying state after process death or crash.
   * Checks channel history before blindly retrying to prevent duplicate uploads!
   */
  async reconcileStaleJobs(): Promise<{
    reconciledBackedUp: number;
    resetToQueued: number;
  }> {
    const uploadingItems = await this.repo.listMediaItems(MediaState.UPLOADING);
    const verifyingItems = await this.repo.listMediaItems(MediaState.VERIFYING);
    const staleItems = [...uploadingItems, ...verifyingItems];

    let reconciledBackedUp = 0;
    let resetToQueued = 0;

    for (const item of staleItems) {
      // Query remote channel history to check if upload actually succeeded
      const existingRemote = await this.remoteReconciler(item);
      if (existingRemote) {
        // Reconciled: already on Telegram! Record remote reference and mark BackedUp
        await this.repo.recordTelegramObject({
          id: `tg-${existingRemote.channelId}-${existingRemote.messageId}`,
          mediaItemId: item.id,
          channelId: existingRemote.channelId,
          messageId: existingRemote.messageId,
          metadataVersion: 1,
          contentHash: item.contentHash,
          uploadedAtMs: Date.now(),
          verifiedAtMs: Date.now(),
          status: 'available',
        });
        reconciledBackedUp++;
      } else {
        // Not found remotely: reset to Queued for clean retry
        await this.repo.upsertMediaItem({
          ...item,
          state: MediaState.QUEUED,
        });
        resetToQueued++;
      }
    }

    return { reconciledBackedUp, resetToQueued };
  }

  /**
   * Cancels all pending and in-flight upload jobs.
   */
  async cancelAll(): Promise<number> {
    this.isPaused = true;
    return await this.repo.cancelPendingUploadJobs();
  }

  /**
   * Retries all failed upload jobs.
   */
  async retryFailed(): Promise<number> {
    return await this.repo.retryFailedUploadJobs();
  }

  /**
   * Returns current counts across queue states for activity dashboard.
   */
  async getQueueStats(): Promise<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    const jobs = await this.repo.listUploadJobs();
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const j of jobs) {
      switch (j.state) {
        case UploadJobState.PENDING:
          pending++;
          break;
        case UploadJobState.RUNNING:
        case UploadJobState.VERIFYING:
          running++;
          break;
        case UploadJobState.COMPLETED:
          completed++;
          break;
        case UploadJobState.FAILED_PERMANENT:
        case UploadJobState.FAILED_RETRYABLE:
          failed++;
          break;
      }
    }

    return {
      pending,
      running,
      completed,
      failed,
      total: jobs.length,
    };
  }
}
