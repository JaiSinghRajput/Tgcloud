import {
  serializeMetadataCaption,
  parseMetadataCaption,
  CURRENT_METADATA_SCHEMA_VERSION,
  APP_IDENTIFIER,
  METADATA_CAPTION_PREFIX,
} from '../src/domain/telegram/metadata';
import { TelegramMetadataEnvelope } from '../src/types/telegram';

describe('Telegram Metadata Envelope Caption Parser & Serializer', () => {
  const sampleEnvelope: TelegramMetadataEnvelope = {
    schemaVersion: CURRENT_METADATA_SCHEMA_VERSION,
    app: APP_IDENTIFIER,
    mediaId: 'media-test-abc123',
    mediaType: 'photo',
    originalName: 'IMG_20261022.jpg',
    relativePath: 'DCIM/Camera/IMG_20261022.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2450123,
    modifiedAtMs: 1792660000000,
    contentHash:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    encryptionEnvelope: null,
  };

  it('serializes envelope with correct prefix and valid JSON payload', () => {
    const caption = serializeMetadataCaption(sampleEnvelope);
    expect(caption.startsWith(METADATA_CAPTION_PREFIX)).toBe(true);

    const jsonStr = caption.slice(METADATA_CAPTION_PREFIX.length);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.v).toBe(1);
    expect(parsed.app).toBe('telegram-gallery-backup');
    expect(parsed.id).toBe('media-test-abc123');
    expect(parsed.type).toBe('photo');
    expect(parsed.size).toBe(2450123);
  });

  it('roundtrips accurately from envelope to caption and back', () => {
    const caption = serializeMetadataCaption(sampleEnvelope);
    const parsed = parseMetadataCaption(caption);

    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe(sampleEnvelope.schemaVersion);
    expect(parsed?.app).toBe(sampleEnvelope.app);
    expect(parsed?.mediaId).toBe(sampleEnvelope.mediaId);
    expect(parsed?.mediaType).toBe(sampleEnvelope.mediaType);
    expect(parsed?.originalName).toBe(sampleEnvelope.originalName);
    expect(parsed?.relativePath).toBe(sampleEnvelope.relativePath);
    expect(parsed?.mimeType).toBe(sampleEnvelope.mimeType);
    expect(parsed?.sizeBytes).toBe(sampleEnvelope.sizeBytes);
    expect(parsed?.modifiedAtMs).toBe(sampleEnvelope.modifiedAtMs);
    expect(parsed?.contentHash).toBe(sampleEnvelope.contentHash);
  });

  it('handles optional encrypted envelope sidecar reference', () => {
    const encEnvelope: TelegramMetadataEnvelope = {
      ...sampleEnvelope,
      mediaType: 'video',
      originalName: 'VID_2026.mp4',
      encryptionEnvelope: 'aes-256-gcm:tag=abc123:iv=xyz789',
    };
    const caption = serializeMetadataCaption(encEnvelope);
    const parsed = parseMetadataCaption(caption);

    expect(parsed?.encryptionEnvelope).toBe('aes-256-gcm:tag=abc123:iv=xyz789');
    expect(parsed?.mediaType).toBe('video');
  });

  it('returns null gracefully on non-matching or corrupt captions', () => {
    expect(parseMetadataCaption(null)).toBeNull();
    expect(parseMetadataCaption('')).toBeNull();
    expect(
      parseMetadataCaption('Just a vacation photo with family'),
    ).toBeNull();
    expect(parseMetadataCaption('#TGB1:not-valid-json')).toBeNull();
    expect(parseMetadataCaption('#TGB1:{"v":99,"app":"other"}')).toBeNull();
    expect(
      parseMetadataCaption('#TGB1:{"v":1,"app":"telegram-gallery-backup"}'),
    ).toBeNull(); // Missing required fields
  });
});
