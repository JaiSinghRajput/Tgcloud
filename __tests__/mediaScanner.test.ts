import {
  MediaScannerService,
  calculateScanReview,
  extractFolderKey,
  deriveFolderLabel,
  confirmInitialScan,
  ScannedMediaItem,
} from '../src/domain/media/scanner';

describe('Media Discovery, Folder Grouping & Scan Review', () => {
  const sampleItems: ScannedMediaItem[] = [
    {
      id: 'item-1',
      sourceKey: 'content://media/external/images/media/1',
      mediaType: 'photo',
      displayName: 'IMG_01.jpg',
      relativePath: 'DCIM/Camera/IMG_01.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2_000_000,
      modifiedAtMs: 1792600000000,
      isExcluded: false,
    },
    {
      id: 'item-2',
      sourceKey: 'content://media/external/images/media/2',
      mediaType: 'photo',
      displayName: 'IMG_02.jpg',
      relativePath: 'DCIM/Camera/IMG_02.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 3_000_000,
      modifiedAtMs: 1792600001000,
      isExcluded: false,
    },
    {
      id: 'item-3',
      sourceKey: 'content://media/external/video/media/3',
      mediaType: 'video',
      displayName: 'VID_01.mp4',
      relativePath: 'DCIM/Camera/VID_01.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 25_000_000,
      modifiedAtMs: 1792600002000,
      isExcluded: false,
    },
    {
      id: 'item-4',
      sourceKey: 'content://media/external/images/media/4',
      mediaType: 'photo',
      displayName: 'screenshot.png',
      relativePath: 'Pictures/Screenshots/screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 1_000_000,
      modifiedAtMs: 1792600003000,
      isExcluded: false,
    },
  ];

  it('normalizes relative paths into folder keys and human-readable display labels', () => {
    expect(extractFolderKey('DCIM/Camera/IMG_01.jpg')).toBe('DCIM/Camera');
    expect(deriveFolderLabel('DCIM/Camera')).toBe('Camera');

    expect(extractFolderKey('Pictures/Screenshots/screenshot.png')).toBe(
      'Pictures/Screenshots',
    );
    expect(deriveFolderLabel('Pictures/Screenshots')).toBe('Screenshots');

    expect(extractFolderKey('root_photo.jpg')).toBe('Root');
    expect(deriveFolderLabel('Root')).toBe('Root');
  });

  it('groups items into folders and computes total counts and bytes', () => {
    const review = calculateScanReview(sampleItems, []);

    expect(review.totalCount).toBe(4);
    expect(review.totalBytes).toBe(31_000_000);
    expect(review.eligibleCount).toBe(4);
    expect(review.eligibleBytes).toBe(31_000_000);
    expect(review.excludedCount).toBe(0);
    expect(review.excludedBytes).toBe(0);

    expect(review.folders).toHaveLength(2);
    const cameraFolder = review.folders.find(
      f => f.folderKey === 'DCIM/Camera',
    );
    expect(cameraFolder?.itemCount).toBe(3);
    expect(cameraFolder?.byteSize).toBe(30_000_000);

    const screenshotFolder = review.folders.find(
      f => f.folderKey === 'Pictures/Screenshots',
    );
    expect(screenshotFolder?.itemCount).toBe(1);
    expect(screenshotFolder?.byteSize).toBe(1_000_000);
  });

  it('applies folder exclusions dynamically and adjusts eligible vs excluded totals', () => {
    // Exclude Screenshots
    const review = calculateScanReview(sampleItems, ['Pictures/Screenshots']);

    expect(review.totalCount).toBe(4);
    expect(review.totalBytes).toBe(31_000_000);
    expect(review.eligibleCount).toBe(3);
    expect(review.eligibleBytes).toBe(30_000_000);
    expect(review.excludedCount).toBe(1);
    expect(review.excludedBytes).toBe(1_000_000);

    const screenshotItem = review.items.find(i => i.id === 'item-4');
    expect(screenshotItem?.isExcluded).toBe(true);

    const cameraItem = review.items.find(i => i.id === 'item-1');
    expect(cameraItem?.isExcluded).toBe(false);
  });

  it('enforces initial scan review confirmation gate before upload can begin', () => {
    const review = calculateScanReview(sampleItems, ['Pictures/Screenshots']);
    expect(review.userConfirmed).toBe(false);

    const confirmation = confirmInitialScan(review);
    expect(confirmation.confirmed).toBe(true);
    expect(confirmation.eligibleItemIds).toHaveLength(3);
    expect(confirmation.eligibleItemIds).toContain('item-1');
    expect(confirmation.eligibleItemIds).toContain('item-2');
    expect(confirmation.eligibleItemIds).toContain('item-3');
    expect(confirmation.eligibleItemIds).not.toContain('item-4');
  });

  it('scans media gallery via MediaScannerService with permission check', async () => {
    const hasPerm = await MediaScannerService.checkPermissions();
    expect(typeof hasPerm).toBe('boolean');

    const result = await MediaScannerService.scanMediaStore([
      'Pictures/Screenshots',
    ]);
    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.eligibleCount + result.excludedCount).toBe(result.totalCount);
    expect(result.eligibleBytes + result.excludedBytes).toBe(result.totalBytes);
    expect(result.userConfirmed).toBe(false);
  });
});
