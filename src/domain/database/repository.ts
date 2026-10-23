import {
  DbMediaItem,
  DbTelegramObject,
  DbUploadJob,
  DbFolderExclusion,
  DbRestoreJob,
  DashboardMetrics,
} from './types';
import {
  MediaState,
  UploadJobState,
  assertMediaTransition,
  generateUploadIdempotencyKey,
} from '../backup/stateMachine';

export interface DatabaseRepository {
  // Media items
  upsertMediaItem(item: DbMediaItem): Promise<DbMediaItem>;
  getMediaItem(id: string): Promise<DbMediaItem | null>;
  findMediaItemBySourceKey(sourceKey: string): Promise<DbMediaItem | null>;
  findMediaItemByContentHash(hash: string): Promise<DbMediaItem | null>;
  listMediaItems(state?: MediaState): Promise<DbMediaItem[]>;

  // Upload jobs
  createUploadJob(
    mediaItemId: string,
    versionNumber?: number,
  ): Promise<DbUploadJob>;
  claimNextUploadJob(): Promise<DbUploadJob | null>;
  updateUploadJobState(
    jobId: string,
    state: UploadJobState,
    errorCode?: string,
    errorSummary?: string,
    nextAttemptAtMs?: number | null,
  ): Promise<void>;
  cancelPendingUploadJobs(): Promise<number>;
  retryFailedUploadJobs(): Promise<number>;
  listUploadJobs(): Promise<DbUploadJob[]>;

  // Remote references
  recordTelegramObject(obj: DbTelegramObject): Promise<void>;
  getTelegramObjectForMedia(
    mediaItemId: string,
  ): Promise<DbTelegramObject | null>;
  deleteTelegramObject(channelId: string, messageId: string): Promise<void>;
  reconcileTelegramObjects(
    channelId: string,
    validMessageIds: Set<string>,
  ): Promise<number>;
  deleteMediaItem(id: string): Promise<void>;

  // Exclusions
  addFolderExclusion(
    folderKey: string,
    displayLabel?: string,
  ): Promise<DbFolderExclusion>;
  removeFolderExclusion(folderKey: string): Promise<void>;
  isFolderExcluded(folderKey: string): Promise<boolean>;
  listFolderExclusions(): Promise<DbFolderExclusion[]>;

  // Settings
  getSetting(key: string, defaultValue?: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // Metrics
  getDashboardMetrics(): Promise<DashboardMetrics>;
}

/**
 * In-memory repository implementing all schema rules, state transitions,
 * and duplicate reconciliation logic for unit testing and portable execution.
 */
export class InMemoryDatabaseRepository implements DatabaseRepository {
  private mediaItems = new Map<string, DbMediaItem>();
  private uploadJobs = new Map<string, DbUploadJob>();
  private telegramObjects = new Map<string, DbTelegramObject>();
  private folderExclusions = new Map<string, DbFolderExclusion>();
  private settings = new Map<string, { value: string; updatedAtMs: number }>();
  private restoreJobs = new Map<string, DbRestoreJob>();

  async upsertMediaItem(item: DbMediaItem): Promise<DbMediaItem> {
    const existing = this.mediaItems.get(item.id);
    if (existing) {
      // Validate transition centrally
      assertMediaTransition(existing.state, item.state);
    }

    const updated: DbMediaItem = {
      ...item,
      updatedAtMsLocal: Date.now(),
    };
    this.mediaItems.set(item.id, updated);
    return updated;
  }

  async getMediaItem(id: string): Promise<DbMediaItem | null> {
    return this.mediaItems.get(id) || null;
  }

  async findMediaItemBySourceKey(
    sourceKey: string,
  ): Promise<DbMediaItem | null> {
    for (const item of this.mediaItems.values()) {
      if (item.sourceKey === sourceKey) return item;
    }
    return null;
  }

  async findMediaItemByContentHash(hash: string): Promise<DbMediaItem | null> {
    for (const item of this.mediaItems.values()) {
      if (item.contentHash === hash) return item;
    }
    return null;
  }

  async listMediaItems(state?: MediaState): Promise<DbMediaItem[]> {
    const items = Array.from(this.mediaItems.values());
    if (state) {
      return items.filter(i => i.state === state);
    }
    return items;
  }

  async createUploadJob(
    mediaItemId: string,
    versionNumber: number = 1,
  ): Promise<DbUploadJob> {
    const media = this.mediaItems.get(mediaItemId);
    if (!media) {
      throw new Error(`Media item not found: ${mediaItemId}`);
    }

    const idempotencyKey = generateUploadIdempotencyKey(
      mediaItemId,
      versionNumber,
      media.contentHash,
    );

    // Prevent duplicate active jobs for the same media version
    for (const job of this.uploadJobs.values()) {
      if (
        job.idempotencyKey === idempotencyKey &&
        job.state !== UploadJobState.COMPLETED
      ) {
        return job;
      }
    }

    const newJob: DbUploadJob = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mediaItemId,
      state: UploadJobState.PENDING,
      attemptCount: 0,
      nextAttemptAtMs: null,
      idempotencyKey,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };

    this.uploadJobs.set(newJob.id, newJob);

    // Transition media state to Queued if permitted
    if (media.state !== MediaState.QUEUED) {
      await this.upsertMediaItem({
        ...media,
        state: MediaState.QUEUED,
      });
    }

    return newJob;
  }

  async claimNextUploadJob(): Promise<DbUploadJob | null> {
    const now = Date.now();
    for (const job of this.uploadJobs.values()) {
      if (
        (job.state === UploadJobState.PENDING ||
          job.state === UploadJobState.FAILED_RETRYABLE) &&
        (job.nextAttemptAtMs == null || job.nextAttemptAtMs <= now)
      ) {
        const claimed: DbUploadJob = {
          ...job,
          state: UploadJobState.CLAIMED,
          attemptCount: job.attemptCount + 1,
          updatedAtMs: now,
        };
        this.uploadJobs.set(job.id, claimed);
        return claimed;
      }
    }
    return null;
  }

  async updateUploadJobState(
    jobId: string,
    state: UploadJobState,
    errorCode?: string,
    errorSummary?: string,
    nextAttemptAtMs?: number | null,
  ): Promise<void> {
    const job = this.uploadJobs.get(jobId);
    if (!job) throw new Error(`Upload job not found: ${jobId}`);

    this.uploadJobs.set(jobId, {
      ...job,
      state,
      lastErrorCode: errorCode ?? job.lastErrorCode,
      lastErrorSummary: errorSummary ?? job.lastErrorSummary,
      nextAttemptAtMs:
        nextAttemptAtMs !== undefined ? nextAttemptAtMs : job.nextAttemptAtMs,
      updatedAtMs: Date.now(),
    });
  }

  async cancelPendingUploadJobs(): Promise<number> {
    let count = 0;
    for (const job of this.uploadJobs.values()) {
      if (
        job.state === UploadJobState.PENDING ||
        job.state === UploadJobState.RUNNING ||
        job.state === UploadJobState.FAILED_RETRYABLE
      ) {
        job.state = UploadJobState.CANCELLED;
        job.updatedAtMs = Date.now();
        count++;
        const media = this.mediaItems.get(job.mediaItemId);
        if (
          media &&
          (media.state === MediaState.QUEUED ||
            media.state === MediaState.UPLOADING)
        ) {
          media.state = MediaState.DISCOVERED;
          media.updatedAtMsLocal = Date.now();
        }
      }
    }
    return count;
  }

  async retryFailedUploadJobs(): Promise<number> {
    let count = 0;
    for (const job of this.uploadJobs.values()) {
      if (
        job.state === UploadJobState.FAILED_RETRYABLE ||
        job.state === UploadJobState.FAILED_PERMANENT
      ) {
        job.state = UploadJobState.PENDING;
        job.attemptCount = 0;
        job.nextAttemptAtMs = null;
        job.lastErrorCode = null;
        job.lastErrorSummary = null;
        job.updatedAtMs = Date.now();
        count++;
        const media = this.mediaItems.get(job.mediaItemId);
        if (media) {
          media.state = MediaState.QUEUED;
          media.updatedAtMsLocal = Date.now();
        }
      }
    }
    return count;
  }

  async listUploadJobs(): Promise<DbUploadJob[]> {
    return Array.from(this.uploadJobs.values());
  }

  async recordTelegramObject(obj: DbTelegramObject): Promise<void> {
    this.telegramObjects.set(obj.id, obj);

    // Mark media item as BackedUp once verified
    const media = this.mediaItems.get(obj.mediaItemId);
    if (media && obj.status === 'available') {
      await this.upsertMediaItem({
        ...media,
        state: MediaState.BACKED_UP,
      });
    }
  }

  async getTelegramObjectForMedia(
    mediaItemId: string,
  ): Promise<DbTelegramObject | null> {
    for (const obj of this.telegramObjects.values()) {
      if (obj.mediaItemId === mediaItemId) return obj;
    }
    return null;
  }

  async deleteTelegramObject(channelId: string, messageId: string): Promise<void> {
    for (const [key, obj] of this.telegramObjects.entries()) {
      if (obj.channelId === channelId && obj.messageId === messageId) {
        this.telegramObjects.delete(key);
        const media = this.mediaItems.get(obj.mediaItemId);
        if (media && media.state === MediaState.BACKED_UP) {
          media.state = MediaState.DISCOVERED;
          media.updatedAtMsLocal = Date.now();
        }
      }
    }
  }

  async reconcileTelegramObjects(
    channelId: string,
    validMessageIds: Set<string>,
  ): Promise<number> {
    let removedCount = 0;
    for (const [key, obj] of this.telegramObjects.entries()) {
      if (obj.channelId === channelId && !validMessageIds.has(obj.messageId)) {
        this.telegramObjects.delete(key);
        removedCount++;
        const media = this.mediaItems.get(obj.mediaItemId);
        if (media && media.state === MediaState.BACKED_UP) {
          media.state = MediaState.DISCOVERED;
          media.updatedAtMsLocal = Date.now();
        }
      }
    }
    return removedCount;
  }

  async deleteMediaItem(id: string): Promise<void> {
    this.mediaItems.delete(id);
    for (const [key, job] of this.uploadJobs.entries()) {
      if (job.mediaItemId === id) {
        this.uploadJobs.delete(key);
      }
    }
    for (const [key, obj] of this.telegramObjects.entries()) {
      if (obj.mediaItemId === id) {
        this.telegramObjects.delete(key);
      }
    }
  }

  async addFolderExclusion(
    folderKey: string,
    displayLabel?: string,
  ): Promise<DbFolderExclusion> {
    const exclusion: DbFolderExclusion = {
      id: `excl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      folderKey,
      displayLabel: displayLabel || folderKey,
      createdAtMs: Date.now(),
    };
    this.folderExclusions.set(folderKey, exclusion);

    // Update items belonging to this folder to Excluded
    for (const item of this.mediaItems.values()) {
      if (
        item.relativePath?.startsWith(folderKey) &&
        item.state !== MediaState.BACKED_UP
      ) {
        this.mediaItems.set(item.id, {
          ...item,
          isExcluded: true,
          state: MediaState.EXCLUDED,
          updatedAtMsLocal: Date.now(),
        });
      }
    }
    return exclusion;
  }

  async removeFolderExclusion(folderKey: string): Promise<void> {
    this.folderExclusions.delete(folderKey);

    // Re-evaluate items that were excluded
    for (const item of this.mediaItems.values()) {
      if (
        item.relativePath?.startsWith(folderKey) &&
        item.state === MediaState.EXCLUDED
      ) {
        this.mediaItems.set(item.id, {
          ...item,
          isExcluded: false,
          state: MediaState.DISCOVERED,
          updatedAtMsLocal: Date.now(),
        });
      }
    }
  }

  async isFolderExcluded(folderKey: string): Promise<boolean> {
    return this.folderExclusions.has(folderKey);
  }

  async listFolderExclusions(): Promise<DbFolderExclusion[]> {
    return Array.from(this.folderExclusions.values());
  }

  async getSetting(key: string, defaultValue: string = ''): Promise<string> {
    return this.settings.get(key)?.value ?? defaultValue;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, { value, updatedAtMs: Date.now() });
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    let totalDiscovered = 0;
    let pending = 0;
    let backedUp = 0;
    let uploading = 0;
    let failed = 0;
    let excluded = 0;
    let lastBackupTimeMs: number | null = null;

    for (const item of this.mediaItems.values()) {
      totalDiscovered++;
      switch (item.state) {
        case MediaState.QUEUED:
        case MediaState.WAITING_FOR_NETWORK:
        case MediaState.RETRY_PENDING:
          pending++;
          break;
        case MediaState.UPLOADING:
        case MediaState.VERIFYING:
          uploading++;
          break;
        case MediaState.BACKED_UP:
          backedUp++;
          break;
        case MediaState.PERMANENT_FAILURE:
          failed++;
          break;
        case MediaState.EXCLUDED:
          excluded++;
          break;
      }
    }

    for (const obj of this.telegramObjects.values()) {
      if (
        obj.verifiedAtMs &&
        (lastBackupTimeMs === null || obj.verifiedAtMs > lastBackupTimeMs)
      ) {
        lastBackupTimeMs = obj.verifiedAtMs;
      }
    }

    return {
      totalDiscovered,
      pending,
      backedUp,
      uploading,
      failed,
      excluded,
      lastBackupTimeMs,
    };
  }
}
