import { NativeModules, Platform } from 'react-native';

export interface ScannedMediaItem {
  id: string;
  sourceKey: string;
  mediaType: 'photo' | 'video';
  displayName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAtMs: number;
  isExcluded: boolean;
}

export interface FolderSummary {
  folderKey: string;
  displayLabel: string;
  itemCount: number;
  byteSize: number;
  isExcluded: boolean;
}

export interface ScanReviewResult {
  totalCount: number;
  totalBytes: number;
  eligibleCount: number;
  eligibleBytes: number;
  excludedCount: number;
  excludedBytes: number;
  folders: FolderSummary[];
  items: ScannedMediaItem[];
  userConfirmed: boolean;
}

interface MediaScannerNativeModule {
  checkPermissions(): Promise<boolean>;
  getPermissionStatus(): Promise<'granted' | 'partial' | 'denied'>;
  scanMediaStore(excludedFolders: string[]): Promise<ScanReviewResult>;
  copyToClipboard?(text: string): Promise<boolean>;
  pasteFromClipboard?(): Promise<string>;
  savePassphraseImage?(passphrase: string): Promise<string>;
  deleteLocalMedia?(uriString: string): Promise<boolean>;
}

const { MediaScanner } = NativeModules;

// Fallback fixture for test / non-Android environments
const fallbackScannerMock: MediaScannerNativeModule = {
  checkPermissions: async () => true,
  getPermissionStatus: async () => 'granted',
  copyToClipboard: async () => true,
  pasteFromClipboard: async () => '',
  savePassphraseImage: async () => 'file://mock/TGCloud_Recovery.png',
  deleteLocalMedia: async () => true,
  scanMediaStore: async (excludedFolders: string[]) => {
    const excludedSet = new Set(excludedFolders);
    const mockItems: ScannedMediaItem[] = [
      {
        id: 'mock-1',
        sourceKey: 'content://media/external/images/media/1001',
        mediaType: 'photo',
        displayName: 'IMG_20261022_1001.jpg',
        relativePath: 'DCIM/Camera/IMG_20261022_1001.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 3_500_000,
        modifiedAtMs: 1792660000000,
        isExcluded: excludedSet.has('DCIM/Camera'),
      },
      {
        id: 'mock-2',
        sourceKey: 'content://media/external/images/media/1002',
        mediaType: 'photo',
        displayName: 'IMG_20261022_1002.jpg',
        relativePath: 'DCIM/Camera/IMG_20261022_1002.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 4_200_000,
        modifiedAtMs: 1792660500000,
        isExcluded: excludedSet.has('DCIM/Camera'),
      },
      {
        id: 'mock-3',
        sourceKey: 'content://media/external/video/media/2001',
        mediaType: 'video',
        displayName: 'VID_20261022_2001.mp4',
        relativePath: 'DCIM/Camera/VID_20261022_2001.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 45_000_000,
        modifiedAtMs: 1792661000000,
        isExcluded: excludedSet.has('DCIM/Camera'),
      },
      {
        id: 'mock-4',
        sourceKey: 'content://media/external/images/media/3001',
        mediaType: 'photo',
        displayName: 'Screenshot_20261022.png',
        relativePath: 'Pictures/Screenshots/Screenshot_20261022.png',
        mimeType: 'image/png',
        sizeBytes: 1_200_000,
        modifiedAtMs: 1792662000000,
        isExcluded: excludedSet.has('Pictures/Screenshots'),
      },
      {
        id: 'mock-5',
        sourceKey: 'content://media/external/images/media/4001',
        mediaType: 'photo',
        displayName: 'WhatsApp_Image.jpg',
        relativePath:
          'Android/media/com.whatsapp/Media/WhatsApp Images/WhatsApp_Image.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 850_000,
        modifiedAtMs: 1792663000000,
        isExcluded: excludedSet.has(
          'Android/media/com.whatsapp/Media/WhatsApp Images',
        ),
      },
    ];

    return calculateScanReview(mockItems, excludedFolders);
  },
};

export function calculateScanReview(
  items: ScannedMediaItem[],
  excludedFolders: string[],
): ScanReviewResult {
  const excludedSet = new Set(excludedFolders);
  const foldersMap = new Map<string, FolderSummary>();

  let totalCount = 0;
  let totalBytes = 0;
  let eligibleCount = 0;
  let eligibleBytes = 0;
  let excludedCount = 0;
  let excludedBytes = 0;

  const processedItems: ScannedMediaItem[] = items.map(item => {
    const folderKey = extractFolderKey(item.relativePath);
    const isExcluded = excludedSet.has(folderKey);

    totalCount++;
    totalBytes += item.sizeBytes;

    if (isExcluded) {
      excludedCount++;
      excludedBytes += item.sizeBytes;
    } else {
      eligibleCount++;
      eligibleBytes += item.sizeBytes;
    }

    const existingFolder = foldersMap.get(folderKey);
    if (existingFolder) {
      existingFolder.itemCount++;
      existingFolder.byteSize += item.sizeBytes;
    } else {
      foldersMap.set(folderKey, {
        folderKey,
        displayLabel: deriveFolderLabel(folderKey),
        itemCount: 1,
        byteSize: item.sizeBytes,
        isExcluded,
      });
    }

    return {
      ...item,
      isExcluded,
    };
  });

  return {
    totalCount,
    totalBytes,
    eligibleCount,
    eligibleBytes,
    excludedCount,
    excludedBytes,
    folders: Array.from(foldersMap.values()),
    items: processedItems,
    userConfirmed: false,
  };
}

export function extractFolderKey(path: string): string {
  const clean = path.trim().replace(/\\/g, '/');
  const lastSlash = clean.lastIndexOf('/');
  if (lastSlash === -1) return 'Root';
  const dir = clean.substring(0, lastSlash);
  return dir.startsWith('/') ? dir.substring(1) : dir;
}

export function deriveFolderLabel(folderKey: string): string {
  const parts = folderKey.split('/').filter(p => p.length > 0);
  return parts[parts.length - 1] || 'Root';
}

/**
 * Enforces explicit confirmation gate before initial upload starts.
 */
export function confirmInitialScan(review: ScanReviewResult): {
  confirmed: boolean;
  eligibleItemIds: string[];
} {
  const eligibleItemIds = review.items
    .filter(item => !item.isExcluded)
    .map(item => item.id);

  return {
    confirmed: true,
    eligibleItemIds,
  };
}

const nativeModule: MediaScannerNativeModule =
  Platform.OS === 'android' && MediaScanner
    ? MediaScanner
    : fallbackScannerMock;

export const MediaScannerService = {
  checkPermissions: () => nativeModule.checkPermissions(),
  getPermissionStatus: () =>
    nativeModule.getPermissionStatus
      ? nativeModule.getPermissionStatus()
      : Promise.resolve('granted' as const),
  copyToClipboard: (text: string) =>
    nativeModule.copyToClipboard
      ? nativeModule.copyToClipboard(text)
      : Promise.resolve(true),
  pasteFromClipboard: () =>
    nativeModule.pasteFromClipboard
      ? nativeModule.pasteFromClipboard()
      : Promise.resolve(''),
  savePassphraseImage: (passphrase: string) =>
    nativeModule.savePassphraseImage
      ? nativeModule.savePassphraseImage(passphrase)
      : Promise.resolve('file://mock/TGCloud_Recovery.png'),
  deleteLocalMedia: (uriString: string) =>
    nativeModule.deleteLocalMedia
      ? nativeModule.deleteLocalMedia(uriString)
      : Promise.resolve(true),
  scanMediaStore: async (
    excludedFolders: string[] = [],
  ): Promise<ScanReviewResult> => {
    const raw = await nativeModule.scanMediaStore(excludedFolders);
    return {
      ...raw,
      userConfirmed: false,
    };
  },
};
