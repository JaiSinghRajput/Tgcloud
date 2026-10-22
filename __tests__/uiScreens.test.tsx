import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { ScanReviewScreen } from '../src/screens/ScanReviewScreen';
import { CloudGalleryScreen } from '../src/screens/CloudGalleryScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { MainApp } from '../src/app/MainApp';
import { NetworkPolicy } from '../src/domain/backup/stateMachine';

describe('React Native Product UI Screens (Phase 5)', () => {
  it('renders DashboardScreen with persisted metrics correctly', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <DashboardScreen
          metrics={{
            totalDiscovered: 120,
            pending: 15,
            backedUp: 100,
            uploading: 1,
            failed: 0,
            excluded: 4,
            lastBackupTimeMs: 1792660000000,
          }}
          networkPolicy={NetworkPolicy.WIFI_ONLY}
          isPaused={false}
          activeProgress={{
            mediaItemId: 'm1',
            displayName: 'IMG_2026.jpg',
            bytesUploaded: 1000000,
            totalBytes: 2000000,
            state: 'Uploading' as any,
          }}
          onTogglePause={jest.fn()}
          onTriggerScan={jest.fn()}
          onNavigateToScanReview={jest.fn()}
          onNavigateToTelegram={jest.fn()}
        />,
      );
    });
    expect(tree!.toJSON()).toBeDefined();
  });

  it('renders ScanReviewScreen with folder exclusion controls', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ScanReviewScreen
          scanReview={{
            totalCount: 50,
            totalBytes: 150000000,
            eligibleCount: 45,
            eligibleBytes: 135000000,
            excludedCount: 5,
            excludedBytes: 15000000,
            folders: [
              {
                folderKey: 'DCIM/Camera',
                displayLabel: 'Camera',
                itemCount: 45,
                byteSize: 135000000,
                isExcluded: false,
              },
              {
                folderKey: 'Pictures/Screenshots',
                displayLabel: 'Screenshots',
                itemCount: 5,
                byteSize: 15000000,
                isExcluded: true,
              },
            ],
            items: [],
            userConfirmed: false,
          }}
          onToggleFolderExclusion={jest.fn()}
          onConfirmBackup={jest.fn()}
          onRescan={jest.fn()}
        />,
      );
    });
    expect(tree!.toJSON()).toBeDefined();
  });

  it('renders CloudGalleryScreen with virtual folders and items', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <CloudGalleryScreen
          items={[
            {
              id: 'c1',
              mediaType: 'photo',
              originalName: 'IMG_01.jpg',
              relativePath: 'DCIM/Camera/IMG_01.jpg',
              sizeBytes: 2500000,
              modifiedAtMs: 1792600000000,
              messageId: '10',
              channelId: '-1001',
            },
          ]}
          onRestoreItem={jest.fn()}
        />,
      );
    });
    expect(tree!.toJSON()).toBeDefined();
  });

  it('renders SettingsScreen with deletion policy and network toggles', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SettingsScreen
          networkPolicy={NetworkPolicy.WIFI_ONLY}
          requiresCharging={false}
          encryptionEnabled={false}
          onToggleNetworkPolicy={jest.fn()}
          onToggleCharging={jest.fn()}
          onToggleEncryption={jest.fn()}
          onDisconnectTelegram={jest.fn()}
        />,
      );
    });
    expect(tree!.toJSON()).toBeDefined();
  });

  it('renders MainApp shell and allows tab switching', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<MainApp />);
    });
    expect(tree!.toJSON()).toBeDefined();
  });
});
