import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CloudGalleryScreen,
  CloudMediaItem,
} from '../screens/CloudGalleryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ProfileScreen, UserProfileInfo } from '../screens/ProfileScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { TelegramBridgeService } from '../native/TelegramBridge';
import { InMemoryDatabaseRepository } from '../domain/database/repository';
import { BackupEngine, BackupTransferProgress } from '../domain/backup/engine';
import {
  MediaScannerService,
  ScanReviewResult,
  confirmInitialScan,
} from '../domain/media/scanner';
import {
  PermissionService,
  MediaPermissionStatus,
} from '../domain/permissions/permissionService';
import { NetworkPolicy, ConflictPolicy } from '../domain/backup/stateMachine';

export type AppTab = 'gallery' | 'settings' | 'profile';

export const MainApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('gallery');

  // Telegram Authentication State Gate
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserProfileInfo | null>(null);

  // Android Media Permission State
  const [permissionStatus, setPermissionStatus] =
    useState<MediaPermissionStatus>('denied');

  const checkPermissionState = useCallback(async () => {
    try {
      const status = await PermissionService.checkMediaPermission();
      setPermissionStatus(status);
      return status;
    } catch {
      return 'denied';
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    TelegramBridgeService.getAuthState()
      .then(state => {
        if (!mounted) return;
        if (state.state === 'READY') {
          setIsLoggedIn(true);
          setCurrentUser({
            userId: state.userId ?? 0,
            firstName: state.firstName ?? '',
            lastName: state.lastName ?? '',
          });
        } else {
          setIsLoggedIn(false);
          setCurrentUser(null);
        }
      })
      .catch(() => {
        if (mounted) {
          setIsLoggedIn(false);
        }
      });

    const unsubscribe = TelegramBridgeService.subscribeToAuthState(state => {
      if (!mounted) return;
      if (state.state === 'READY') {
        setIsLoggedIn(true);
        setCurrentUser({
          userId: state.userId ?? 0,
          firstName: state.firstName ?? '',
          lastName: state.lastName ?? '',
        });
      } else {
        setIsLoggedIn(false);
        setCurrentUser(null);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

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

  // Operational Settings & Backup State
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

  const isScanningRef = React.useRef(false);

  const refreshScan = useCallback(
    async (excludedFolders: string[] = []) => {
      if (isScanningRef.current) return;
      isScanningRef.current = true;
      try {
        const review = await MediaScannerService.scanMediaStore(
          excludedFolders,
        );
        setScanReview(review);
      } catch {
        // Handled safely
      } finally {
        isScanningRef.current = false;
      }
    },
    [],
  );

  // Sync permissions and initial scan on login
  useEffect(() => {
    if (isLoggedIn) {
      checkPermissionState().then(status => {
        if (status === 'granted' || status === 'partial') {
          refreshScan();
        }
      });
    }
  }, [isLoggedIn, checkPermissionState, refreshScan]);

  // Refresh permissions and scan when returning to foreground
  useEffect(() => {
    let lastChecked = 0;
    const subscription = AppState.addEventListener('change', nextAppState => {
      const now = Date.now();
      if (nextAppState === 'active' && isLoggedIn && now - lastChecked > 3000) {
        lastChecked = now;
        checkPermissionState().then(status => {
          if (status === 'granted' || status === 'partial') {
            refreshScan();
          }
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isLoggedIn, checkPermissionState, refreshScan]);

  const handleRequestPermission = async () => {
    const status = await PermissionService.requestMediaPermission();
    setPermissionStatus(status);
    if (status === 'granted' || status === 'partial') {
      refreshScan();
    }
  };

  const handleOpenAppSettings = async () => {
    await PermissionService.openAppSettings();
  };

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

  const handleConfirmBackup = async (selectedIds?: string[]) => {
    let eligibleIds: string[];
    if (selectedIds && selectedIds.length > 0) {
      eligibleIds = selectedIds;
    } else {
      const { confirmed, eligibleItemIds } = confirmInitialScan(scanReview);
      if (!confirmed || eligibleItemIds.length === 0) return;
      eligibleIds = eligibleItemIds;
    }

    // Persist discovered eligible items to repository
    for (const item of scanReview.items) {
      if (eligibleIds.includes(item.id) && !item.isExcluded) {
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

    // Enqueue jobs in SQLite engine
    await engine.queueMediaForBackup(eligibleIds);

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

  const handleLogout = async () => {
    try {
      await TelegramBridgeService.logOut();
    } catch {
      // Handled
    }
    // Clear user state and cached media to prevent leaks across sessions
    setIsLoggedIn(false);
    setCurrentUser(null);
    setCloudItems([]);
    setScanReview({
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
    setActiveTab('gallery');
  };

  // Render LoginScreen exclusively if user is not authenticated
  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <LoginScreen
          onLoginSuccess={user => {
            setIsLoggedIn(true);
            setCurrentUser(user);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Main Screen Content */}
      <View style={styles.screenContainer}>
        {activeTab === 'gallery' && (
          <CloudGalleryScreen
            items={cloudItems}
            scannedItems={scanReview.items}
            folders={scanReview.folders}
            eligibleCount={scanReview.eligibleCount}
            eligibleBytes={scanReview.eligibleBytes}
            isPaused={isPaused}
            activeProgress={activeProgress}
            mediaPermissionStatus={permissionStatus}
            onRequestPermission={handleRequestPermission}
            onOpenAppSettings={handleOpenAppSettings}
            onRescan={() => refreshScan()}
            onToggleFolderExclusion={handleToggleFolderExclusion}
            onConfirmBackup={handleConfirmBackup}
            onTogglePause={handleTogglePause}
            onRestoreItem={handleRestoreItem}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsScreen
            networkPolicy={networkPolicy}
            requiresCharging={requiresCharging}
            encryptionEnabled={encryptionEnabled}
            isPaused={isPaused}
            mediaPermissionStatus={permissionStatus}
            user={currentUser}
            onToggleNetworkPolicy={wifiOnly =>
              setNetworkPolicy(
                wifiOnly
                  ? NetworkPolicy.WIFI_ONLY
                  : NetworkPolicy.WIFI_AND_CELLULAR,
              )
            }
            onToggleCharging={setRequiresCharging}
            onToggleEncryption={setEncryptionEnabled}
            onTogglePause={handleTogglePause}
            onRequestPermission={handleRequestPermission}
            onOpenAppSettings={handleOpenAppSettings}
            onNavigateToProfile={() => setActiveTab('profile')}
            onDisconnectTelegram={handleLogout}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileScreen
            user={currentUser}
            onLogout={handleLogout}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        )}
      </View>

      {/* Minimal 3-Tab Bottom Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'gallery' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('gallery')}
          accessibilityLabel="Gallery tab"
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'gallery' && styles.navIconActive,
            ]}
          >
            🖼️
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'gallery' && styles.navLabelActive,
            ]}
          >
            Gallery
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'settings' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('settings')}
          accessibilityLabel="Settings tab"
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

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'profile' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('profile')}
          accessibilityLabel="Profile tab"
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'profile' && styles.navIconActive,
            ]}
          >
            👤
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'profile' && styles.navLabelActive,
            ]}
          >
            Profile
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
    paddingHorizontal: 16,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: '#16221c',
  },
  navIcon: {
    fontSize: 20,
    opacity: 0.6,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  navLabelActive: {
    color: '#34d399',
    fontWeight: '700',
  },
});
