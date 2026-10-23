import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import {
  InAppVideoPlayer,
  InAppVideoPlayerProps,
} from '../src/components/InAppVideoPlayer';
import { AppIcon, IconButton } from '../src/components/AppIcon';
import {
  CloudGalleryScreen,
  CloudMediaItem,
  DiscoveredMediaItem,
} from '../src/screens/CloudGalleryScreen';
import { MainApp } from '../src/app/MainApp';
import { TelegramBridgeService } from '../src/native/TelegramBridge';

const mockPhoto: DiscoveredMediaItem = {
  id: 'device-photo-1',
  sourceKey: 'file:///storage/emulated/0/DCIM/Camera/IMG_20261023_001.jpg',
  displayName: 'IMG_20261023_001.jpg',
  relativePath: 'DCIM/Camera/IMG_20261023_001.jpg',
  mediaType: 'photo',
  sizeBytes: 3500000,
  modifiedAtMs: 1792600000000,
};

const mockPhoto2: DiscoveredMediaItem = {
  id: 'device-photo-2',
  sourceKey: 'file:///storage/emulated/0/DCIM/Camera/IMG_20261023_002.jpg',
  displayName: 'IMG_20261023_002.jpg',
  relativePath: 'DCIM/Camera/IMG_20261023_002.jpg',
  mediaType: 'photo',
  sizeBytes: 4200000,
  modifiedAtMs: 1792601000000,
};

const mockVideo: DiscoveredMediaItem = {
  id: 'device-video-1',
  sourceKey: 'file:///storage/emulated/0/DCIM/Camera/VID_20261023_001.mp4',
  displayName: 'VID_20261023_001.mp4',
  relativePath: 'DCIM/Camera/VID_20261023_001.mp4',
  mediaType: 'video',
  sizeBytes: 25000000,
  modifiedAtMs: 1792602000000,
};

const mockCloudItem: CloudMediaItem = {
  id: 'cloud-photo-1',
  mediaType: 'photo',
  originalName: 'IMG_CLOUD_001.jpg',
  relativePath: 'DCIM/Camera/IMG_CLOUD_001.jpg',
  sizeBytes: 3100000,
  modifiedAtMs: 1792600000000,
  messageId: '501',
  channelId: '-1001234567890',
  isEncrypted: false,
};

describe('UI Cleanup & Video Player Controls', () => {
  describe('1. InAppVideoPlayer Playback State & Controls', () => {
    test('displays loading spinner initially and responds to play/pause controls', () => {
      let root: renderer.ReactTestRenderer;
      const onPlaybackStateChange = jest.fn();

      act(() => {
        root = renderer.create(
          <InAppVideoPlayer
            sourceUri="file:///storage/emulated/0/DCIM/Camera/VID_20261023_001.mp4"
            onPlaybackStateChange={onPlaybackStateChange}
            testID="test-player"
          />,
        );
      });

      // 1. Initially displays loading / buffering overlay with spinner
      const allText = root!.root
        .findAllByType('Text' as any)
        .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)));
      expect(allText.some(t => t.includes('Buffering video...'))).toBe(true);

      const surface = root!.root.findByProps({ testID: 'test-player-fallback-surface' });
      expect(surface).toBeDefined();

      const toggleBtn = root!.root.findByProps({ testID: 'test-player-toggle-btn' });
      expect(toggleBtn).toBeDefined();

      // 2. User taps play/pause button to start playback
      act(() => {
        toggleBtn.props.onPress();
      });
      expect(onPlaybackStateChange).toHaveBeenCalledWith('playing');

      // Toggle button reflects 'playing' state
      expect(toggleBtn.props.accessibilityLabel).toBe('Pause video');

      // 3. User taps toggle button to pause
      act(() => {
        toggleBtn.props.onPress();
      });
      expect(onPlaybackStateChange).toHaveBeenCalledWith('paused');
      expect(toggleBtn.props.accessibilityLabel).toBe('Play video');
    });

    test('replays from beginning when playback has ended', () => {
      let root: renderer.ReactTestRenderer;
      const onPlaybackStateChange = jest.fn();

      act(() => {
        root = renderer.create(
          <InAppVideoPlayer
            sourceUri="file:///storage/emulated/0/DCIM/Camera/VID_20261023_001.mp4"
            onPlaybackStateChange={onPlaybackStateChange}
            testID="test-player"
          />,
        );
      });

      const toggleBtn = root!.root.findByProps({ testID: 'test-player-toggle-btn' });

      // Start playing
      act(() => {
        toggleBtn.props.onPress();
      });
      expect(onPlaybackStateChange).toHaveBeenCalledWith('playing');

      // Toggling again pauses
      act(() => {
        toggleBtn.props.onPress();
      });
      expect(onPlaybackStateChange).toHaveBeenCalledWith('paused');
    });

    test('displays error overlay when playback fails and offers retry', () => {
      let root: renderer.ReactTestRenderer;
      const onError = jest.fn();
      const onPlaybackStateChange = jest.fn();

      act(() => {
        root = renderer.create(
          <InAppVideoPlayer
            sourceUri="file:///invalid/path/video.mp4"
            onError={onError}
            onPlaybackStateChange={onPlaybackStateChange}
            testID="test-player"
          />,
        );
      });

      const container = root!.root.findByProps({ testID: 'test-player' });
      expect(container).toBeDefined();
    });
  });

  describe('2. Compact Accessible Icon Buttons', () => {
    test('renders AppIcon and IconButton with consistent sizing and accessibility labels', () => {
      const handlePress = jest.fn();
      let root: renderer.ReactTestRenderer;

      act(() => {
        root = renderer.create(
          <IconButton
            name="trash"
            size={44}
            iconSize={20}
            variant="destructive"
            accessibilityLabel="Delete item"
            onPress={handlePress}
            testID="test-trash-btn"
          />,
        );
      });

      const btn = root!.root.findByProps({ testID: 'test-trash-btn' });
      expect(btn).toBeDefined();
      expect(btn.props.accessibilityLabel).toBe('Delete item');

      act(() => {
        btn.props.onPress();
      });
      expect(handlePress).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Move Delete Action to Bottom Action Bar (Unobstructed Top Header)', () => {
    test('media viewer top overlay has NO delete button, reserving top for filename and index', async () => {
      let root: renderer.ReactTestRenderer;
      const handleDeleteLocal = jest.fn().mockResolvedValue(true);

      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={[mockPhoto]}
            onRestoreItem={async () => true}
            onDeleteLocalMedia={handleDeleteLocal}
          />,
        );
      });

      // Open photo in viewer
      const gridList = root!.root.findByType(FlatList);
      const renderedItem = gridList.props.renderItem({ item: mockPhoto, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Top area: close button and counter badge exist
      const closeBtn = root!.root.findByProps({ testID: 'viewer-close-btn' });
      expect(closeBtn).toBeDefined();
      expect(closeBtn.props.accessibilityLabel).toBe('Close media viewer');

      // Index and filename are visible in the top counter badge
      const allText = root!.root
        .findAllByType('Text' as any)
        .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)));
      expect(allText.some(t => t.includes('1 / 1'))).toBe(true);
      expect(allText.some(t => t.includes('IMG_20261023_001.jpg'))).toBe(true);

      // Verify bottom action bar exists and contains the delete button
      const bottomBar = root!.root.findByProps({ testID: 'viewer-bottom-bar' });
      expect(bottomBar).toBeDefined();

      const deleteBtn = root!.root.findByProps({ testID: 'viewer-delete-btn' });
      expect(deleteBtn).toBeDefined();

      // Trigger deletion prompts confirmation modal
      await act(async () => {
        deleteBtn.props.onPress();
      });

      const modal = root!.root.findByProps({ testID: 'delete-confirmation-modal' });
      expect(modal.props.visible).toBe(true);

      // Confirm deletion identifies local device operation
      const modalText = root!.root
        .findAllByType('Text' as any)
        .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)));
      expect(modalText.some(t => t.includes('Delete from Device Gallery?'))).toBe(true);
      expect(modalText.some(t => t.includes('local device storage'))).toBe(true);
    });

    test('cloud media deletion identifies cloud operation and does not affect local original', async () => {
      let root: renderer.ReactTestRenderer;
      const handleDeleteCloud = jest.fn().mockResolvedValue({ successCount: 1, failedCount: 0 });

      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[mockCloudItem]}
            scannedItems={[]}
            initialView="cloud"
            onRestoreItem={async () => true}
            onDeleteCloudMedia={handleDeleteCloud}
          />,
        );
      });

      // Open cloud item in viewer
      const gridList = root!.root.findByType(FlatList);
      const renderedItem = gridList.props.renderItem({ item: mockCloudItem, index: 0 });
      await act(async () => {
        renderedItem.props.onPress();
      });

      // Bottom bar has download/restore button and delete button
      const restoreBtn = root!.root.findByProps({ testID: 'viewer-restore-btn' });
      expect(restoreBtn).toBeDefined();

      const deleteBtn = root!.root.findByProps({ testID: 'viewer-delete-btn' });
      expect(deleteBtn).toBeDefined();

      // Prompt delete
      await act(async () => {
        deleteBtn.props.onPress();
      });

      const modalText = root!.root
        .findAllByType('Text' as any)
        .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)));
      expect(modalText.some(t => t.includes('Delete Backup from Cloud?'))).toBe(true);
      expect(modalText.some(t => t.includes('Your local gallery file will NOT be deleted.'))).toBe(true);
    });
  });

  describe('4. Selection Mode Bottom Action Bar', () => {
    test('displays selection bottom bar with count, select-all, cancel, and delete/backup buttons', async () => {
      let root: renderer.ReactTestRenderer;

      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={[mockPhoto, mockPhoto2]}
            onRestoreItem={async () => true}
          />,
        );
      });

      // Toggle selection mode on
      const selectModeBtn = root!.root.findByProps({ testID: 'device-select-mode-btn' });
      await act(async () => {
        selectModeBtn.props.onPress();
      });

      // Selection bottom bar is rendered
      const selectionBar = root!.root.findByProps({ testID: 'selection-bottom-bar' });
      expect(selectionBar).toBeDefined();

      // Select-all button
      const selectAllBtn = root!.root.findByProps({ testID: 'select-all-toggle-btn' });
      expect(selectAllBtn).toBeDefined();

      // Tap select-all
      await act(async () => {
        selectAllBtn.props.onPress();
      });

      // Verify count updated to 2 Selected
      const allText = root!.root
        .findAllByType('Text' as any)
        .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)));
      expect(allText.some(t => t.includes('2 Selected'))).toBe(true);

      // Cancel button exits selection mode
      const cancelBtn = root!.root.findByProps({ testID: 'cancel-select-btn' });
      await act(async () => {
        cancelBtn.props.onPress();
      });

      // Selection bar is hidden when selection mode is exited
      expect(root!.root.findAllByProps({ testID: 'selection-bottom-bar' })).toHaveLength(0);
    });
  });

  describe('5. Streamlined 4-Tab Navigation (Gallery, Cloud, Settings, Profile)', () => {
    test('MainApp provides exactly 4 core tabs and excludes redundant activity tab', async () => {
      const authSpy = jest.spyOn(TelegramBridgeService, 'getAuthState').mockResolvedValue({
        state: 'READY',
        userId: 12345,
        firstName: 'Alex',
        lastName: 'Hunter',
      });

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(<MainApp />);
      });

      // Core 4 destinations are present
      expect(root!.root.findByProps({ accessibilityLabel: 'Gallery tab' })).toBeDefined();
      expect(root!.root.findByProps({ accessibilityLabel: 'Cloud tab' })).toBeDefined();
      expect(root!.root.findByProps({ accessibilityLabel: 'Settings tab' })).toBeDefined();
      expect(root!.root.findByProps({ accessibilityLabel: 'Profile tab' })).toBeDefined();

      // Redundant tabs are NOT present
      expect(root!.root.findAllByProps({ accessibilityLabel: 'Activity tab' })).toHaveLength(0);
      expect(root!.root.findAllByProps({ accessibilityLabel: 'Dashboard tab' })).toHaveLength(0);
      expect(root!.root.findAllByProps({ accessibilityLabel: 'Scan Review tab' })).toHaveLength(0);

      authSpy.mockRestore();
    });
  });
});
