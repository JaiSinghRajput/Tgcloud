import { PermissionsAndroid, Platform, Linking } from 'react-native';
import { MediaScannerService } from '../media/scanner';

export type MediaPermissionStatus = 'granted' | 'partial' | 'denied' | 'blocked';

/**
 * Handles cross-version Android Photo and Video permissions:
 * - Android 14+ (API 34+): READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED
 * - Android 13 (API 33): READ_MEDIA_IMAGES, READ_MEDIA_VIDEO
 * - Android 12 & below (API <= 32): READ_EXTERNAL_STORAGE
 */
export const PermissionService = {
  /**
   * Checks the current storage / media permission state.
   */
  async checkMediaPermission(): Promise<MediaPermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    try {
      const nativeStatus = await MediaScannerService.getPermissionStatus();
      if (nativeStatus === 'granted' || nativeStatus === 'partial') {
        return nativeStatus;
      }
    } catch {
      // Fallback to PermissionsAndroid
    }

    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);

    if (apiLevel >= 34) {
      // Android 14+
      const [hasImages, hasVideo, hasSelected] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO),
        PermissionsAndroid.check(
          (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_VISUAL_USER_SELECTED ||
            'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        ),
      ]);

      if (hasImages && hasVideo) return 'granted';
      if (hasSelected || hasImages || hasVideo) return 'partial';
      return 'denied';
    }

    if (apiLevel === 33) {
      // Android 13
      const [hasImages, hasVideo] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO),
      ]);

      if (hasImages && hasVideo) return 'granted';
      if (hasImages || hasVideo) return 'partial';
      return 'denied';
    }

    // Android 12 and below
    const hasStorage = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    );
    return hasStorage ? 'granted' : 'denied';
  },

  /**
   * Triggers the Android runtime permission dialog requesting photo & video access.
   */
  async requestMediaPermission(): Promise<MediaPermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);

    try {
      if (apiLevel >= 34) {
        const visualUserSelectedPerm =
          (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_VISUAL_USER_SELECTED ||
          'android.permission.READ_MEDIA_VISUAL_USER_SELECTED';

        const permissions = [
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
          visualUserSelectedPerm,
        ];

        const rawResults = await PermissionsAndroid.requestMultiple(permissions);
        const results = rawResults as unknown as Record<string, string>;

        const img = results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES];
        const vid = results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO];
        const selected = results[visualUserSelectedPerm];

        if (
          img === PermissionsAndroid.RESULTS.GRANTED &&
          vid === PermissionsAndroid.RESULTS.GRANTED
        ) {
          return 'granted';
        }

        if (
          selected === PermissionsAndroid.RESULTS.GRANTED ||
          img === PermissionsAndroid.RESULTS.GRANTED ||
          vid === PermissionsAndroid.RESULTS.GRANTED
        ) {
          return 'partial';
        }

        if (
          img === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
          vid === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        ) {
          return 'blocked';
        }

        return 'denied';
      }

      if (apiLevel === 33) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ]);

        const img = results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES];
        const vid = results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO];

        if (
          img === PermissionsAndroid.RESULTS.GRANTED &&
          vid === PermissionsAndroid.RESULTS.GRANTED
        ) {
          return 'granted';
        }

        if (
          img === PermissionsAndroid.RESULTS.GRANTED ||
          vid === PermissionsAndroid.RESULTS.GRANTED
        ) {
          return 'partial';
        }

        if (
          img === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
          vid === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        ) {
          return 'blocked';
        }

        return 'denied';
      }

      // Android 12 and below
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        {
          title: 'Photo and Video Access',
          message:
            'TG Cloud needs access to your device storage to find and backup your photos and videos to Telegram.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );

      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        return 'granted';
      }
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        return 'blocked';
      }
      return 'denied';
    } catch {
      return 'denied';
    }
  },

  /**
   * Opens Android App Info settings screen when permission is permanently denied.
   */
  async openAppSettings(): Promise<void> {
    try {
      await Linking.openSettings();
    } catch {
      // Ignored
    }
  },
};
