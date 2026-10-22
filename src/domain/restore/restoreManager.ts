import { Buffer } from 'buffer';
import { DatabaseRepository } from '../database/repository';
import { TelegramHistoryItem } from '../../types/telegram';
import { ConflictPolicy, MediaState } from '../backup/stateMachine';
import { DbMediaItem, DbTelegramObject } from '../database/types';
import { EncryptedItemEnvelope } from '../../types/encryption';
import {
  decryptBuffer,
  decryptMediaPayload,
} from '../crypto/encryptionService';

export interface RestoreItemResult {
  mediaId: string;
  originalName: string;
  restoredPath: string | null;
  status: 'restored' | 'skipped' | 'missing' | 'failed';
  error?: string;
}

/**
 * Manages remote-history index rebuild, multi-item/folder restore,
 * filename collision policies, and client-side decryption as defined in Gate B & Gate E.
 */
export class RestoreManager {
  constructor(private readonly repo: DatabaseRepository) {}

  /**
   * Rebuilds the local database index from remote Telegram channel history.
   * Validates Gate B & Gate E: reconstructs virtual gallery and decrypts metadata if master key is provided.
   */
  async rebuildIndexFromRemoteHistory(
    historyItems: TelegramHistoryItem[],
    masterKey?: Buffer,
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

      let displayName = item.originalName;
      let relativePath = item.relativePath;
      let mimeType = item.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
      let contentHash = item.contentHash || null;

      // If item has encryption envelope and masterKey is available, decrypt metadata
      if (item.encryptionEnvelope) {
        const encObj: EncryptedItemEnvelope | null =
          typeof item.encryptionEnvelope === 'string'
            ? (() => {
                try {
                  return JSON.parse(item.encryptionEnvelope as string);
                } catch {
                  return null;
                }
              })()
            : item.encryptionEnvelope;

        if (masterKey && encObj?.encryptedDek && encObj?.encryptedMeta) {
          try {
            const dekBuffer = Buffer.from(encObj.encryptedDek, 'base64');
            const dek = decryptBuffer(
              dekBuffer,
              masterKey,
              encObj.dekIv,
              encObj.dekTag,
            );
            const metaJson = decryptBuffer(
              Buffer.from(encObj.encryptedMeta, 'base64'),
              dek,
              encObj.metaIv!,
              encObj.metaTag!,
            ).toString('utf8');
            const meta = JSON.parse(metaJson);
            displayName = meta.originalName || displayName;
            relativePath = meta.relativePath || relativePath;
            mimeType = meta.mimeType || mimeType;
            contentHash = meta.contentHash || contentHash;
          } catch {
            displayName = 'Encrypted Item (Corrupted or Bad Key)';
          }
        } else if (!masterKey && item.originalName === 'encrypted.bin') {
          displayName = 'Encrypted Item (Locked)';
        }
      }

      // Reconstruct local media record from remote metadata envelope
      const mediaItem: DbMediaItem = {
        id: item.mediaId,
        sourceKey: null, // remote index rebuild has no prior local MediaStore key
        mediaType: item.mediaType,
        displayName,
        relativePath,
        mimeType,
        sizeBytes: item.sizeBytes,
        modifiedAtMs: item.modifiedAtMs,
        createdAtMs: item.modifiedAtMs,
        contentHash,
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
        contentHash,
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
   * Decrypts metadata for previously locked encrypted media items once masterKey is provided.
   */
  async unlockEncryptedMedia(
    historyItems: TelegramHistoryItem[],
    masterKey: Buffer,
  ): Promise<number> {
    let unlocked = 0;
    for (const item of historyItems) {
      if (!item.encryptionEnvelope) continue;
      const encObj: EncryptedItemEnvelope | null =
        typeof item.encryptionEnvelope === 'string'
          ? (() => {
              try {
                return JSON.parse(item.encryptionEnvelope as string);
              } catch {
                return null;
              }
            })()
          : item.encryptionEnvelope;

      if (encObj?.encryptedDek && encObj?.encryptedMeta) {
        try {
          const dekBuffer = Buffer.from(encObj.encryptedDek, 'base64');
          const dek = decryptBuffer(
            dekBuffer,
            masterKey,
            encObj.dekIv,
            encObj.dekTag,
          );
          const metaJson = decryptBuffer(
            Buffer.from(encObj.encryptedMeta, 'base64'),
            dek,
            encObj.metaIv!,
            encObj.metaTag!,
          ).toString('utf8');
          const meta = JSON.parse(metaJson);

          const existing = await this.repo.getMediaItem(item.mediaId);
          if (existing) {
            await this.repo.upsertMediaItem({
              ...existing,
              displayName: meta.originalName || existing.displayName,
              relativePath: meta.relativePath || existing.relativePath,
              mimeType: meta.mimeType || existing.mimeType,
              contentHash: meta.contentHash || existing.contentHash,
            });
            unlocked++;
          }
        } catch {
          // Authentication tag failed or corrupted item
        }
      }
    }
    return unlocked;
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
   * Restores items executing download, decryption (if encrypted), conflict resolution, and path preservation.
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
    masterKey?: Buffer,
  ): Promise<RestoreItemResult[]> {
    const results: RestoreItemResult[] = [];

    for (const item of items) {
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

        let writeContent: string | undefined = downloaded.content;
        let resolvedName = item.originalName;
        let resolvedRelPath = item.relativePath || item.originalName;

        // Decrypt if item is encrypted
        if (item.encryptionEnvelope) {
          if (!masterKey) {
            results.push({
              mediaId: item.mediaId,
              originalName: item.originalName,
              restoredPath: null,
              status: 'failed',
              error: 'Decryption key required to restore encrypted media',
            });
            continue;
          }

          const encObj: EncryptedItemEnvelope =
            typeof item.encryptionEnvelope === 'string'
              ? JSON.parse(item.encryptionEnvelope as string)
              : item.encryptionEnvelope;

          const encryptedBuffer = Buffer.from(
            downloaded.content || '',
            'base64',
          );
          const decrypted = decryptMediaPayload(
            encryptedBuffer,
            encObj,
            masterKey,
          );

          writeContent = decrypted.decryptedMedia.toString('base64');
          resolvedName = decrypted.metadata.originalName;
          resolvedRelPath =
            decrypted.metadata.relativePath || decrypted.metadata.originalName;
        }

        const targetFullPath = `${targetBaseDir.replace(
          /\\/g,
          '/',
        )}/${resolvedRelPath.replace(/\\/g, '/')}`;

        // Apply conflict policy
        const resolution = this.resolveConflict(
          targetFullPath,
          policy,
          fileExistsFn,
        );
        if (resolution.action === 'skip') {
          results.push({
            mediaId: item.mediaId,
            originalName: resolvedName,
            restoredPath: null,
            status: 'skipped',
          });
          continue;
        }

        // Write restored file
        await writeFileFn(resolution.finalPath, writeContent);

        results.push({
          mediaId: item.mediaId,
          originalName: resolvedName,
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
