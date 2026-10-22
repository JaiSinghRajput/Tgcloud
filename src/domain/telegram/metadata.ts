import { TelegramMetadataEnvelope } from '../../types/telegram';

export const CURRENT_METADATA_SCHEMA_VERSION = 1;
export const APP_IDENTIFIER = 'telegram-gallery-backup';
export const METADATA_CAPTION_PREFIX = '#TGB1:';

export function serializeMetadataCaption(
  envelope: TelegramMetadataEnvelope,
): string {
  const payload = {
    v: envelope.schemaVersion,
    app: envelope.app,
    id: envelope.mediaId,
    type: envelope.mediaType,
    name: envelope.originalName,
    path: envelope.relativePath,
    mime: envelope.mimeType,
    size: envelope.sizeBytes,
    mod: envelope.modifiedAtMs,
    ...(envelope.contentHash ? { hash: envelope.contentHash } : {}),
    ...(envelope.encryptionEnvelope
      ? { enc: envelope.encryptionEnvelope }
      : {}),
  };
  return `${METADATA_CAPTION_PREFIX}${JSON.stringify(payload)}`;
}

export function parseMetadataCaption(
  caption?: string | null,
): TelegramMetadataEnvelope | null {
  if (!caption) return null;
  const prefixIndex = caption.indexOf(METADATA_CAPTION_PREFIX);
  if (prefixIndex === -1) return null;

  try {
    const jsonStr = caption
      .substring(prefixIndex + METADATA_CAPTION_PREFIX.length)
      .trim();
    const data = JSON.parse(jsonStr);

    if (
      data.v !== CURRENT_METADATA_SCHEMA_VERSION ||
      data.app !== APP_IDENTIFIER
    ) {
      return null;
    }

    if (!data.id || !data.type || !data.name || typeof data.size !== 'number') {
      return null;
    }

    return {
      schemaVersion: data.v,
      app: data.app,
      mediaId: data.id,
      mediaType: data.type,
      originalName: data.name,
      relativePath: data.path || '',
      mimeType: data.mime || 'application/octet-stream',
      sizeBytes: data.size,
      modifiedAtMs: data.mod || 0,
      contentHash: data.hash || null,
      encryptionEnvelope: data.enc || null,
    };
  } catch {
    return null;
  }
}
