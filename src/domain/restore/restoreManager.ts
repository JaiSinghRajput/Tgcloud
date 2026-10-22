import { DatabaseRepository } from '../database/repository';
import { TelegramHistoryItem } from '../../types/telegram';
import { ConflictPolicy, MediaState } from '../backup/stateMachine';
import { DbMediaItem, DbTelegramObject } from '../database/types';

export interface RestoreItemResult {
  mediaId: string;
  originalName: string;
  restoredPath: string | null;
  status: 'restored' | 'skipped' | 'missing' | 'failed';
  error?: string;
}

/**
 * Manages remote-history index rebuild, multi-item/folder restore,
 * and filename collision policies as defined in PRD.md Section 5.5 and Gate B.
 */
export class RestoreManager {
  constructor(private readonly repo: DatabaseRepository) {}

  /**
   * Rebuilds the local database index from remote Telegram channel history.
   * Validates Gate B: clean installation recoverability without prior SQLite database.
   */
  async rebuildIndexFromRemoteHistory(
    historyItems: TelegramHistoryItem[],
  ): Promise<{ indexedCount: number; duplicateCount: number }> {
    let indexedCount = 0;
    let duplicateCount = 0;

    for (const item of historyItems) {
      // Check if item already exists in local DB
      const existing = await this.repo.getMediaItem(item.mediaId);
      if (existing) {
        duplicateCount++;
        continue;
      }

      // Reconstruct local media record from remote metadata envelope
      const mediaItem: DbMediaItem = {
        id: item.mediaId,
        sourceKey: null, // remote index rebuild has no prior local MediaStore key
        mediaType: item.mediaType,
        displayName: item.originalName,
        relativePath: item.relativePath,
        mimeType: item.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
        sizeBytes: item.sizeBytes,
        modifiedAtMs: item.modifiedAtMs,
        createdAtMs: item.modifiedAtMs,
        contentHash: item.contentHash || null,
        state: MediaState.BACKED_UP,
        isExcluded: false,
        lastScannedAtMs: Date.now(),
        createdAtMsLocal: Date.now(),
        updatedAtMsLocal: Date.now(),
      };

      await this.repo.upsertMediaItem(mediaItem);

      // Record Telegram remote reference
      const tgObject: DbTelegramObject = {
        id: `tg-${item.chatId}-${item.messageId}`,
        mediaItemId: item.mediaId,
        channelId: item.chatId,
        messageId: item.messageId,
        remoteFileId: item.fileId.toString(),
        metadataVersion: 1,
        contentHash: item.contentHash || null,
        uploadedAtMs: item.date * 1000,
        verifiedAtMs: Date.now(),
        status: 'available',
      };

      await this.repo.recordTelegramObject(tgObject);
      indexedCount++;
    }

    return { indexedCount, duplicateCount };
  }

  /**
   * Resolves collision when target restore file already exists locally.
   */
  resolveConflict(
    targetPath: string,
    policy: ConflictPolicy,
    fileExistsFn: (path: string) => boolean,
  ): { action: 'write' | 'skip'; finalPath: string } {
    if (!fileExistsFn(targetPath)) {
      return { action: 'write', finalPath: targetPath };
    }

    switch (policy) {
      case ConflictPolicy.SKIP:
        return { action: 'skip', finalPath: targetPath };

      case ConflictPolicy.REPLACE:
        return { action: 'write', finalPath: targetPath };

      case ConflictPolicy.KEEP_BOTH: {
        const lastDot = targetPath.lastIndexOf('.');
        const lastSlash = Math.max(
          targetPath.lastIndexOf('/'),
          targetPath.lastIndexOf('\\'),
        );

        let basePath: string;
        let ext: string;

        if (lastDot > lastSlash) {
          basePath = targetPath.substring(0, lastDot);
          ext = targetPath.substring(lastDot);
        } else {
          basePath = targetPath;
          ext = '';
        }

        let counter = 1;
        let candidate: string;
        do {
          candidate = `${basePath} (${counter})${ext}`;
          counter++;
        } while (fileExistsFn(candidate));

        return { action: 'write', finalPath: candidate };
      }
    }
  }

  /**
   * Restores items executing download, conflict resolution, and path preservation.
   */
  async restoreItems(
    items: TelegramHistoryItem[],
    targetBaseDir: string,
    policy: ConflictPolicy,
    downloader: (
      fileId: number,
    ) => Promise<{ bytes: number; content?: string } | null>,
    fileExistsFn: (path: string) => boolean,
    writeFileFn: (path: string, content?: string) => Promise<void>,
  ): Promise<RestoreItemResult[]> {
    const results: RestoreItemResult[] = [];

    for (const item of items) {
      const targetRelPath = item.relativePath || item.originalName;
      const targetFullPath = `${targetBaseDir.replace(
        /\\/g,
        '/',
      )}/${targetRelPath.replace(/\\/g, '/')}`;

      try {
        // Download from Telegram
        const downloaded = await downloader(item.fileId);
        if (!downloaded) {
          results.push({
            mediaId: item.mediaId,
            originalName: item.originalName,
            restoredPath: null,
            status: 'missing',
            error: 'Cloud object missing or download failed',
          });
          continue;
        }

        // Apply conflict policy
        const resolution = this.resolveConflict(
          targetFullPath,
          policy,
          fileExistsFn,
        );
        if (resolution.action === 'skip') {
          results.push({
            mediaId: item.mediaId,
            originalName: item.originalName,
            restoredPath: null,
            status: 'skipped',
          });
          continue;
        }

        // Write restored file
        await writeFileFn(resolution.finalPath, downloaded.content);

        results.push({
          mediaId: item.mediaId,
          originalName: item.originalName,
          restoredPath: resolution.finalPath,
          status: 'restored',
        });
      } catch (err: any) {
        results.push({
          mediaId: item.mediaId,
          originalName: item.originalName,
          restoredPath: null,
          status: 'failed',
          error: err?.message || 'Restore write failure',
        });
      }
    }

    return results;
  }
}
