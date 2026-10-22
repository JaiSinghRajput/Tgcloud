import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList } from 'react-native';
import {
  CloudGalleryScreen,
  DiscoveredMediaItem,
} from '../src/screens/CloudGalleryScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { InAppVideoPlayer } from '../src/components/InAppVideoPlayer';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import { SessionKeyStore } from '../src/domain/crypto/encryptionService';
import { NetworkPolicy } from '../src/domain/backup/stateMachine';

describe('Critical Regression Fix: Channel Setup, Black Video Screen, and Immersive Viewer', () => {
  const mockLocalPhoto: DiscoveredMediaItem = {
    id: 'local-photo-10',
    sourceKey: 'content://media/external/images/media/301',
    mediaType: 'photo',
    displayName: 'vacation_sunset.jpg',
    relativePath: 'DCIM/Camera',
    sizeBytes: 3500000,
    modifiedAtMs: 1700000000000,
  };

  const mockLocalVideo: DiscoveredMediaItem = {
    id: 'local-video-20',
    sourceKey: 'file:///storage/emulated/0/DCIM/Camera/VID_20261022.mp4',
    mediaType: 'video',
    displayName: 'VID_20261022.mp4',
    relativePath: 'DCIM/Camera',
    sizeBytes: 42000000,
    modifiedAtMs: 1700000010000,
  };

  beforeEach(() => {
    SessionKeyStore.clear();
    jest.clearAllMocks();
  });

  describe('Issue 1: Telegram Channel Setup & Read-only Refresh Lifecycle', () => {
    test('SettingsScreen displays setup destinations card when channels is null or uninitialized', async () => {
      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <SettingsScreen
            networkPolicy={NetworkPolicy.WIFI_ONLY}
            requiresCharging={false}
            encryptionEnabled={false}
            channels={null}
            onToggleNetworkPolicy={() => {}}
            onToggleCharging={() => {}}
            onToggleEncryption={() => {}}
            onDisconnectTelegram={() => {}}
          />,
        );
      });

      const setupCard = root!.root.findByProps({ testID: 'setup-destinations-card' });
      expect(setupCard).toBeDefined();

      const setupBtn = root!.root.findByProps({ testID: 'setup-channels-btn' });
      expect(setupBtn).toBeDefined();
    });

    test('Initial setup triggers channel creation via onSetupDestinations', async () => {
      const setupDestinationsSpy = jest.fn().mockResolvedValue(undefined);
      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <SettingsScreen
            networkPolicy={NetworkPolicy.WIFI_ONLY}
            requiresCharging={false}
            encryptionEnabled={false}
            channels={null}
            onToggleNetworkPolicy={() => {}}
            onToggleCharging={() => {}}
            onToggleEncryption={() => {}}
            onDisconnectTelegram={() => {}}
            onSetupDestinations={setupDestinationsSpy}
          />,
        );
      });

      const setupBtn = root!.root.findByProps({ testID: 'setup-channels-btn' });
      await act(async () => {
        await setupBtn.props.onPress();
      });

      expect(setupDestinationsSpy).toHaveBeenCalledTimes(1);
    });

    test('Sync now is purely read-only and never calls channel setup or creation', async () => {
      const resyncSpy = jest.fn();
      const setupChannelsSpy = jest.spyOn(TelegramBridgeService, 'setupChannels');
      const createDestSpy = jest.spyOn(TelegramBridgeService, 'createDestination');

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <SettingsScreen
            networkPolicy={NetworkPolicy.WIFI_ONLY}
            requiresCharging={false}
            encryptionEnabled={false}
            channels={{
              photoChannelId: '-100111',
              photoChannelTitle: 'Photos',
              videoChannelId: '-100222',
              videoChannelTitle: 'Videos',
              verified: true,
              photoStatus: { channelId: '-100111', title: 'Photos', state: 'CONNECTED' },
              videoStatus: { channelId: '-100222', title: 'Videos', state: 'CONNECTED' },
            }}
            onToggleNetworkPolicy={() => {}}
            onToggleCharging={() => {}}
            onToggleEncryption={() => {}}
            onDisconnectTelegram={() => {}}
            onResyncChannels={resyncSpy}
          />,
        );
      });

      const syncBtn = root!.root.findByProps({ testID: 'sync-destinations-btn' });
      await act(async () => {
        syncBtn.props.onPress();
      });

      expect(resyncSpy).toHaveBeenCalledTimes(1);
      expect(setupChannelsSpy).not.toHaveBeenCalled();
      expect(createDestSpy).not.toHaveBeenCalled();

      setupChannelsSpy.mockRestore();
      createDestSpy.mockRestore();
    });
  });

  describe('Issue 2: Black Video Screen & Video Pipeline Fixes', () => {
    test('InAppVideoPlayer mounts and receives valid sourceUri', () => {
      let root: renderer.ReactTestRenderer;
      act(() => {
        root = renderer.create(
          <InAppVideoPlayer
            sourceUri="file:///storage/emulated/0/DCIM/Camera/VID_20261022.mp4"
            testID="test-video-player"
          />,
        );
      });

      // Renders player container with testID
      const container = root!.root.findByProps({ testID: 'test-video-player' });
      expect(container).toBeDefined();

      // Displays fallback or native surface with active video URI
      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(allText.some(t => t.includes('VID_20261022.mp4'))).toBe(true);
    });

    test('InAppVideoPlayer shows loading overlay initially while source is prepared', () => {
      let root: renderer.ReactTestRenderer;
      act(() => {
        root = renderer.create(
          <InAppVideoPlayer
            sourceUri="file:///storage/emulated/0/DCIM/Camera/VID_20261022.mp4"
            testID="test-video-player"
          />,
        );
      });

      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(allText.some(t => t.includes('Buffering video...'))).toBe(true);
    });
  });

  describe('Issue 3: Immersive Viewer Redesign (Removed Old Dashboard / Bottom Bar)', () => {
    test('Viewer does not render old bottom bar, backup button, or metadata card', async () => {
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

      // Open photo
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockLocalPhoto, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Verify old dashboard/card elements are completely gone
      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });

      expect(allText.some(t => t.includes('Backup to Telegram'))).toBe(false);
      expect(allText.some(t => t.includes('Restore to Photos'))).toBe(false);
      expect(allText.some(t => t.includes('Status:'))).toBe(false);

      // Verify floating close button exists
      const closeBtn = root!.root.findByProps({ accessibilityLabel: 'Close media viewer' });
      expect(closeBtn).toBeDefined();
    });

    test('Video in viewer renders with minimal immersive player and no extraneous panels', async () => {
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

      // Open video
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockLocalVideo, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      const videoPlayer = root!.root.findByProps({ testID: 'in-app-video-player' });
      expect(videoPlayer).toBeDefined();
      expect(videoPlayer.props.sourceUri).toBe(mockLocalVideo.sourceKey);

      // Verify no backup button or restore button in video view
      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(allText.some(t => t.includes('Backup to Telegram'))).toBe(false);
    });

    test('supports swiping and arrow navigation between photos and videos in gallery view', async () => {
      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={[mockLocalPhoto, mockLocalVideo]}
            onRestoreItem={async () => true}
          />,
        );
      });

      // Open first item (photo)
      const flatList = root!.root.findByType(FlatList);
      const renderedItem = flatList.props.renderItem({ item: mockLocalPhoto, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Verify horizontal viewer list is present
      const horizontalList = root!.root.findByProps({ testID: 'viewer-horizontal-list' });
      expect(horizontalList).toBeDefined();
      expect(horizontalList.props.horizontal).toBe(true);
      expect(horizontalList.props.pagingEnabled).toBe(true);

      // Verify item counter displays '1 / 2'
      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(allText.some(t => t.includes('1 / 2'))).toBe(true);

      // Navigate to next item (video) via next button
      const nextBtn = root!.root.findByProps({ testID: 'viewer-next-btn' });
      expect(nextBtn).toBeDefined();

      await act(async () => {
        nextBtn.props.onPress();
      });

      // Verify item counter updates to '2 / 2'
      const updatedText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(updatedText.some(t => t.includes('2 / 2'))).toBe(true);

      // Navigate back to previous item (photo) via prev button
      const prevBtn = root!.root.findByProps({ testID: 'viewer-prev-btn' });
      expect(prevBtn).toBeDefined();

      await act(async () => {
        prevBtn.props.onPress();
      });

      const finalTexts = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(finalTexts.some(t => t.includes('1 / 2'))).toBe(true);
    });
  });
});

