import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DashboardScreen } from '../screens/DashboardScreen';
import { ScanReviewScreen } from '../screens/ScanReviewScreen';
import {
  CloudGalleryScreen,
  CloudMediaItem,
} from '../screens/CloudGalleryScreen';
import { TelegramPocScreen } from '../screens/TelegramPocScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { InMemoryDatabaseRepository } from '../domain/database/repository';
import { BackupEngine, BackupTransferProgress } from '../domain/backup/engine';
import {
  MediaScannerService,
  ScanReviewResult,
  confirmInitialScan,
} from '../domain/media/scanner';
import { NetworkPolicy, ConflictPolicy } from '../domain/backup/stateMachine';
import { DashboardMetrics } from '../domain/database/types';

export type AppTab =
  | 'dashboard'
  | 'scan-review'
  | 'cloud-gallery'
  | 'telegram'
  | 'settings';

export const MainApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');

  // Repositories & Engine
  const repo = useMemo(() => new InMemoryDatabaseRepository(), []);
  const engine = useMemo(() => {
    return new BackupEngine(
      repo,
      async item => ({
        channelId: item.mediaType === 'video' ? '-100999002' : '-100999001',
        messageId: Math.floor(Math.random() * 10000).toString(),
        contentHash: item.contentHash,
      }),
      async () => null,
    );
  }, [repo]);

  // States
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalDiscovered: 0,
    pending: 0,
    backedUp: 0,
    uploading: 0,
    failed: 0,
    excluded: 0,
    lastBackupTimeMs: null,
  });

  const [networkPolicy, setNetworkPolicy] = useState<NetworkPolicy>(
    NetworkPolicy.WIFI_ONLY,
  );
  const [requiresCharging, setRequiresCharging] = useState<boolean>(false);
  const [encryptionEnabled, setEncryptionEnabled] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeProgress, setActiveProgress] =
    useState<BackupTransferProgress | null>(null);

  const [scanReview, setScanReview] = useState<ScanReviewResult>({
    totalCount: 0,
    totalBytes: 0,
    eligibleCount: 0,
    eligibleBytes: 0,
    excludedCount: 0,
    excludedBytes: 0,
    folders: [],
    items: [],
    userConfirmed: false,
  });

  const [cloudItems, setCloudItems] = useState<CloudMediaItem[]>([]);

  const refreshScan = React.useCallback(
    async (excludedFolders: string[] = []) => {
      try {
        const review = await MediaScannerService.scanMediaStore(
          excludedFolders,
        );
        setScanReview(review);
      } catch {
        // handled
      }
    },
    [],
  );

  const refreshMetrics = React.useCallback(async () => {
    const m = await repo.getDashboardMetrics();
    setMetrics(m);
  }, [repo]);

  // Initial gallery scan and metrics sync
  useEffect(() => {
    refreshScan();
    refreshMetrics();
  }, [refreshScan, refreshMetrics]);

  const handleToggleFolderExclusion = (folderKey: string) => {
    const isCurrentlyExcluded = scanReview.folders.find(
      f => f.folderKey === folderKey,
    )?.isExcluded;
    const currentExcluded = scanReview.folders
      .filter(f =>
        f.folderKey === folderKey ? !isCurrentlyExcluded : f.isExcluded,
      )
      .map(f => f.folderKey);

    refreshScan(currentExcluded);
  };

  const handleConfirmBackup = async () => {
    const { confirmed, eligibleItemIds } = confirmInitialScan(scanReview);
    if (!confirmed || eligibleItemIds.length === 0) return;

    // Persist discovered eligible items to repository
    for (const item of scanReview.items) {
      if (!item.isExcluded) {
        await repo.upsertMediaItem({
          id: item.id,
          sourceKey: item.sourceKey,
          mediaType: item.mediaType,
          displayName: item.displayName,
          relativePath: item.relativePath,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          modifiedAtMs: item.modifiedAtMs,
          createdAtMs: item.modifiedAtMs,
          state: 'Discovered' as any,
          isExcluded: false,
          lastScannedAtMs: Date.now(),
          createdAtMsLocal: Date.now(),
          updatedAtMsLocal: Date.now(),
        });
      }
    }

    // Enqueue jobs in SQLite
    await engine.queueMediaForBackup(eligibleItemIds);
    await refreshMetrics();

    setActiveTab('dashboard');

    // Run queue simulation
    engine.runQueue(networkPolicy, true, {
      onProgress: p => setActiveProgress(p),
      onJobCompleted: (_job, media) => {
        setCloudItems(prev => [
          ...prev,
          {
            id: media.id,
            mediaType: media.mediaType,
            originalName: media.displayName,
            relativePath: media.relativePath || 'DCIM/Camera',
            sizeBytes: media.sizeBytes,
            modifiedAtMs: media.modifiedAtMs,
            messageId: '101',
            channelId: '-100999001',
          },
        ]);
        setActiveProgress(null);
        refreshMetrics();
      },
    });
  };

  const handleTogglePause = () => {
    if (isPaused) {
      engine.resume();
      setIsPaused(false);
    } else {
      engine.pause();
      setIsPaused(true);
      setActiveProgress(null);
    }
  };

  const handleRestoreItem = async (
    _item: CloudMediaItem,
    _policy: ConflictPolicy,
  ): Promise<boolean> => {
    return new Promise(resolve => setTimeout(() => resolve(true), 800));
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Main Content Area */}
      <View style={styles.screenContainer}>
        {activeTab === 'dashboard' && (
          <DashboardScreen
            metrics={metrics}
            networkPolicy={networkPolicy}
            isPaused={isPaused}
            activeProgress={activeProgress}
            onTogglePause={handleTogglePause}
            onTriggerScan={() => refreshScan()}
            onNavigateToScanReview={() => setActiveTab('scan-review')}
            onNavigateToTelegram={() => setActiveTab('telegram')}
          />
        )}

        {activeTab === 'scan-review' && (
          <ScanReviewScreen
            scanReview={scanReview}
            onToggleFolderExclusion={handleToggleFolderExclusion}
            onConfirmBackup={handleConfirmBackup}
            onRescan={() => refreshScan()}
          />
        )}

        {activeTab === 'cloud-gallery' && (
          <CloudGalleryScreen
            items={cloudItems}
            onRestoreItem={handleRestoreItem}
          />
        )}

        {activeTab === 'telegram' && <TelegramPocScreen />}

        {activeTab === 'settings' && (
          <SettingsScreen
            networkPolicy={networkPolicy}
            requiresCharging={requiresCharging}
            encryptionEnabled={encryptionEnabled}
            onToggleNetworkPolicy={wifiOnly =>
              setNetworkPolicy(
                wifiOnly
                  ? NetworkPolicy.WIFI_ONLY
                  : NetworkPolicy.WIFI_AND_CELLULAR,
              )
            }
            onToggleCharging={setRequiresCharging}
            onToggleEncryption={setEncryptionEnabled}
            onDisconnectTelegram={() => setActiveTab('telegram')}
          />
        )}
      </View>

      {/* Bottom Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'dashboard' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('dashboard')}
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'dashboard' && styles.navIconActive,
            ]}
          >
            📊
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'dashboard' && styles.navLabelActive,
            ]}
          >
            Dashboard
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'scan-review' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('scan-review')}
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'scan-review' && styles.navIconActive,
            ]}
          >
            📁
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'scan-review' && styles.navLabelActive,
            ]}
          >
            Scan Review
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'cloud-gallery' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('cloud-gallery')}
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'cloud-gallery' && styles.navIconActive,
            ]}
          >
            ☁️
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'cloud-gallery' && styles.navLabelActive,
            ]}
          >
            Gallery
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'telegram' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('telegram')}
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'telegram' && styles.navIconActive,
            ]}
          >
            ✈️
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'telegram' && styles.navLabelActive,
            ]}
          >
            Telegram
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'settings' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('settings')}
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'settings' && styles.navIconActive,
            ]}
          >
            ⚙️
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'settings' && styles.navLabelActive,
            ]}
          >
            Settings
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
  },
  screenContainer: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: '#0e1411',
    borderTopColor: '#243029',
    borderTopWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: '#16221c',
  },
  navIcon: {
    fontSize: 18,
    opacity: 0.6,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  navLabelActive: {
    color: '#34d399',
    fontWeight: '700',
  },
});
