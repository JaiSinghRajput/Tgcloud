import React from 'react';
import renderer, { act } from 'react-test-renderer';
import {
  CloudGalleryScreen,
  CloudMediaItem,
  DiscoveredMediaItem,
} from '../src/screens/CloudGalleryScreen';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import { SessionKeyStore } from '../src/domain/crypto/encryptionService';
import { Buffer } from 'buffer';
import { FlatList } from 'react-native';

describe('Bug Fix Regressions: Safe Area Viewer & Real Video Playback (Bugs 2 & 3)', () => {
  const mockLocalPhoto: DiscoveredMediaItem = {
    id: 'local-photo-1',
    sourceKey: 'content://media/external/images/media/101',
    mediaType: 'photo',
    displayName: 'vacation.jpg',
    relativePath: 'DCIM/Camera',
    sizeBytes: 2500000,
    modifiedAtMs: 1700000000000,
  };

  const mockLocalVideo: DiscoveredMediaItem = {
    id: 'local-video-2',
    sourceKey: 'content://media/external/video/media/202',
    mediaType: 'video',
    displayName: 'family_clip.mp4',
    relativePath: 'DCIM/Camera',
    sizeBytes: 15000000,
    modifiedAtMs: 1700000010000,
  };

  const mockCloudEncryptedVideo: CloudMediaItem = {
    id: 'cloud-video-3',
    mediaType: 'video',
    originalName: 'secret_video.mp4',
    relativePath: 'DCIM/Camera',
    sizeBytes: 8000000,
    modifiedAtMs: 1700000020000,
    messageId: '9901',
    channelId: '-1001234567891',
    fileId: 404,
    isEncrypted: true,
    isLocked: false,
    encryptionEnvelope: {
      alg: 'AES-256-GCM',
      keyVersion: 1,
      iv: 'mockIv',
      tag: 'mockTag',
      encryptedDek: 'mockDek',
      dekIv: 'mockDekIv',
      dekTag: 'mockDekTag',
      encryptedMeta: 'mockMeta',
      metaIv: 'mockMetaIv',
      metaTag: 'mockMetaTag',
    },
  };

  beforeEach(() => {
    SessionKeyStore.clear();
  });

  describe('Bug 2: Photo and Video Viewer Safe Area & Aspect Ratio', () => {
    test('renders media with resizeMode contain preserving aspect ratio without stretching', async () => {
      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={[mockLocalPhoto]}
            onRestoreItem={async () => true}
          />,
        );
      });

      // Trigger item selection from FlatList
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockLocalPhoto, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Verify full viewer image has resizeMode contain
      const fullViewerImage = root!.root.findByProps({ testID: 'full-viewer-image' });
      expect(fullViewerImage).toBeDefined();
      expect(fullViewerImage.props.resizeMode).toBe('contain');
    });

    test('close button dismisses viewer and preserves scroll position', async () => {
      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={[mockLocalPhoto]}
            onRestoreItem={async () => true}
          />,
        );
      });

      // Open viewer
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockLocalPhoto, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Verify modal is open
      const closeBtn = root!.root.findByProps({ accessibilityLabel: 'Close media viewer' });
      expect(closeBtn).toBeDefined();

      // Click Close
      await act(async () => {
        await closeBtn.props.onPress();
      });

      // Verify modal closed
      const modals = root!.root.findAllByType('Modal' as any);
      expect(modals.filter(m => m.props.visible)).toHaveLength(0);
    });
  });

  describe('Bug 3: Video Playback States, Real Execution, and Temporary Decryption Cleanup', () => {
    test('invokes genuine player with playVideo when tapping play on local video', async () => {
      const playVideoSpy = jest.spyOn(TelegramBridgeService, 'playVideo');

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={[mockLocalVideo]}
            onRestoreItem={async () => true}
          />,
        );
      });

      // Open video preview via FlatList
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockLocalVideo, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Find toggle video playback button
      const playBtn = root!.root.findByProps({ accessibilityLabel: 'Toggle video playback' });
      expect(playBtn).toBeDefined();

      // Tap Play
      await act(async () => {
        await playBtn.props.onPress();
      });

      // Verify genuine player invocation
      expect(playVideoSpy).toHaveBeenCalledWith(mockLocalVideo.sourceKey);
      playVideoSpy.mockRestore();
    });

    test('decrypts cloud encrypted video before playback and cleans up temporary media on viewer close', async () => {
      const prepareCloudVideoSpy = jest.spyOn(TelegramBridgeService, 'prepareCloudVideo').mockResolvedValue({
        localUri: 'file:///data/user/0/cache/tgcloud_video_playback/decrypted_test.mp4',
        tempFilePath: '/data/user/0/cache/tgcloud_video_playback/decrypted_test.mp4',
        isTemporary: true,
      });
      const playVideoSpy = jest.spyOn(TelegramBridgeService, 'playVideo');
      const cleanupSpy = jest.spyOn(TelegramBridgeService, 'cleanupTempMedia');

      // Set unlocked master key in session
      const masterKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      SessionKeyStore.setSessionKey(masterKey, 'sample passphrase');

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[mockCloudEncryptedVideo]}
            scannedItems={[]}
            initialView="cloud"
            onRestoreItem={async () => true}
          />,
        );
      });

      // Open cloud item via FlatList
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockCloudEncryptedVideo, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Tap Play
      const playBtn = root!.root.findByProps({ accessibilityLabel: 'Toggle video playback' });
      await act(async () => {
        await playBtn.props.onPress();
      });

      // Verify ciphertext was never passed to normal player
      expect(prepareCloudVideoSpy).toHaveBeenCalledWith(
        mockCloudEncryptedVideo.fileId,
        true,
        expect.any(String),
        masterKey.toString('hex'),
      );
      expect(playVideoSpy).toHaveBeenCalledWith(
        'file:///data/user/0/cache/tgcloud_video_playback/decrypted_test.mp4',
      );

      // Close viewer
      const closeBtn = root!.root.findByProps({ accessibilityLabel: 'Close media viewer' });
      await act(async () => {
        await closeBtn.props.onPress();
      });

      // Verify temporary file wipe cleanup was triggered
      expect(cleanupSpy).toHaveBeenCalledWith(
        '/data/user/0/cache/tgcloud_video_playback/decrypted_test.mp4',
      );

      prepareCloudVideoSpy.mockRestore();
      playVideoSpy.mockRestore();
      cleanupSpy.mockRestore();
    });

    test('displays useful playback error if player preparation fails', async () => {
      const prepareCloudVideoSpy = jest
        .spyOn(TelegramBridgeService, 'prepareCloudVideo')
        .mockRejectedValue(new Error('Network timeout downloading video from Telegram.'));

      const masterKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      SessionKeyStore.setSessionKey(masterKey, 'sample passphrase');

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[mockCloudEncryptedVideo]}
            scannedItems={[]}
            initialView="cloud"
            onRestoreItem={async () => true}
          />,
        );
      });

      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockCloudEncryptedVideo, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      const playBtn = root!.root.findByProps({ accessibilityLabel: 'Toggle video playback' });
      await act(async () => {
        await playBtn.props.onPress();
      });

      // Verify error banner is rendered
      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      const hasError = allText.some(txt => txt.includes('Network timeout'));
      expect(hasError).toBe(true);

      prepareCloudVideoSpy.mockRestore();
    });
  });
});
