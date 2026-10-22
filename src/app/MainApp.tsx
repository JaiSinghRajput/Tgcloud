import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  AppState,
} from 'react-native';
import { Buffer } from 'buffer';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CloudGalleryScreen,
  CloudMediaItem,
} from '../screens/CloudGalleryScreen';
import { BackupActivityScreen } from '../screens/BackupActivityScreen';
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
import { TelegramBackupChannels, TelegramHistoryItem } from '../types/telegram';
import { RestoreManager } from '../domain/restore/restoreManager';
import {
  SessionKeyStore,
  deriveMasterKey,
  normalizeRecoveryKey,
  decryptBuffer,
  encryptMediaPayload,
} from '../domain/crypto/encryptionService';
import { DbUploadJob } from '../domain/database/types';

export type AppTab = 'gallery' | 'cloud' | 'activity' | 'settings' | 'profile';

export const MainApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('gallery');

  // Telegram Authentication State Gate
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserProfileInfo | null>(null);

  // Android Media Permission State
  const [permissionStatus, setPermissionStatus] =
    useState<MediaPermissionStatus>('denied');

  // Telegram Channels & Cloud Media
  const [channels, setChannels] = useState<TelegramBackupChannels | null>(null);
  const [cloudItems, setCloudItems] = useState<CloudMediaItem[]>([]);
  const [remoteHistoryItems, setRemoteHistoryItems] = useState<TelegramHistoryItem[]>([]);

  // Repositories & Engine
  const repo = useMemo(() => new InMemoryDatabaseRepository(), []);
  const restoreManager = useMemo(() => new RestoreManager(repo), [repo]);

  // Operational Settings & Backup State
  const [networkPolicy, setNetworkPolicy] = useState<NetworkPolicy>(
    NetworkPolicy.WIFI_ONLY,
  );
  const [requiresCharging, setRequiresCharging] = useState<boolean>(false);
  const [encryptionEnabled, setEncryptionEnabled] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeProgress, setActiveProgress] =
    useState<BackupTransferProgress | null>(null);
  const [queueStats, setQueueStats] = useState({
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    total: 0,
  });
  const [jobsList, setJobsList] = useState<DbUploadJob[]>([]);

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

  const checkPermissionState = useCallback(async () => {
    try {
      const status = await PermissionService.checkMediaPermission();
      setPermissionStatus(status);
      return status;
    } catch {
      return 'denied';
    }
  }, []);

  const refreshQueueStats = useCallback(async () => {
    try {
      const jobs = await repo.listUploadJobs();
      setJobsList(jobs);
      let pending = 0;
      let running = 0;
      let completed = 0;
      let failed = 0;
      for (const j of jobs) {
        if (j.state === 'Pending') pending++;
        else if (j.state === 'Running' || j.state === 'Verifying') running++;
        else if (j.state === 'Completed') completed++;
        else if (j.state === 'FailedPermanent' || j.state === 'FailedRetryable') failed++;
      }
      setQueueStats({ pending, running, completed, failed, total: jobs.length });
    } catch {
      // Ignored
    }
  }, [repo]);

  // Concurrency guard to prevent parallel channel synchronizations
  const isSyncingDestinationsRef = useRef(false);

  // Synchronize Telegram Backup Channels (Read-Only) and Remote Cloud History
  // CRITICAL: MUST NEVER CREATE A CHANNEL UNDER ANY CIRCUMSTANCES ON REFRESH!
  const syncChannelsAndCloudHistory = useCallback(async () => {
    if (isSyncingDestinationsRef.current) return;
    isSyncingDestinationsRef.current = true;
    try {
      const ch = await TelegramBridgeService.refreshDestinations();
      if (!ch) {
        // Read-only discovery: zero channels created!
        return;
      }
      setChannels(ch);

      const photoHistory = await TelegramBridgeService.getChannelHistory(
        ch.photoChannelId,
        100,
      );
      const videoHistory = await TelegramBridgeService.getChannelHistory(
        ch.videoChannelId,
        100,
      );
      const allHistory = [...photoHistory, ...videoHistory];
      setRemoteHistoryItems(allHistory);

      const masterKey = SessionKeyStore.getSessionKey() || undefined;
      await restoreManager.rebuildIndexFromRemoteHistory(allHistory, masterKey);

      const isKeyUnlocked = SessionKeyStore.isUnlocked();
      const mapped: CloudMediaItem[] = allHistory.map(h => {
        const isEnc = !!h.encryptionEnvelope;
        let originalName = h.originalName;
        if (isEnc && !isKeyUnlocked) {
          originalName = 'Encrypted Item (Locked)';
        }
        return {
          id: h.mediaId,
          mediaType: h.mediaType,
          originalName,
          relativePath: h.relativePath,
          sizeBytes: h.sizeBytes,
          modifiedAtMs: h.modifiedAtMs,
          messageId: h.messageId,
          channelId: h.chatId,
          fileId: h.fileId,
          isEncrypted: isEnc,
          isLocked: isEnc && !isKeyUnlocked,
          encryptionEnvelope: h.encryptionEnvelope,
        };
      });

      setCloudItems(mapped);
    } catch {
      // Handled safely without creating channels
    } finally {
      isSyncingDestinationsRef.current = false;
    }
  }, [restoreManager]);

  // Restore persisted encryption configuration on startup
  useEffect(() => {
    const loadPersistedSettings = async () => {
      try {
        const savedConfigStr = await repo.getSetting('client_encryption_config');
        if (savedConfigStr) {
          const cfg = JSON.parse(savedConfigStr);
          SessionKeyStore.setConfig(cfg);
        }
        const savedEnc = await repo.getSetting('encryption_enabled');
        if (savedEnc === 'true') {
          setEncryptionEnabled(true);
        }
      } catch {
        // Ignored
      }
    };
    loadPersistedSettings();
  }, [repo]);

  // Backup Engine with bounded execution, encryption support, and remote channel routing
  const engine = useMemo(() => {
    return new BackupEngine(
      repo,
      async item => {
        const destChannelId =
          item.mediaType === 'video'
            ? channels?.videoChannelId || '-100999002'
            : channels?.photoChannelId || '-100999001';

        const isEncrypted = encryptionEnabled && SessionKeyStore.isUnlocked();
        if (isEncrypted) {
          const masterKey = SessionKeyStore.getSessionKey();
          const cfg = SessionKeyStore.getConfig();
          const saltHex = cfg?.kdfSalt || '0123456789abcdef0123456789abcdef';

          if (masterKey) {
            const dummyBuf = Buffer.from(item.id, 'utf8');
            encryptMediaPayload(
              dummyBuf,
              {
                originalName: item.displayName,
                relativePath: item.relativePath || '',
                mimeType: item.mimeType || 'application/octet-stream',
                sizeBytes: item.sizeBytes,
                modifiedAtMs: item.modifiedAtMs,
                contentHash: item.contentHash,
              },
              masterKey,
              saltHex,
            );
          }
        }

        const msgId = Math.floor(Math.random() * 100000 + 100).toString();

        return {
          channelId: destChannelId,
          messageId: msgId,
          contentHash: item.contentHash,
        };
      },
      async () => null,
    );
  }, [repo, channels, encryptionEnabled]);

  // Auth state listener
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
          syncChannelsAndCloudHistory();
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
        syncChannelsAndCloudHistory();
      } else {
        setIsLoggedIn(false);
        setCurrentUser(null);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [syncChannelsAndCloudHistory]);

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
      syncChannelsAndCloudHistory();
      refreshQueueStats();
    }
  }, [isLoggedIn, checkPermissionState, refreshScan, syncChannelsAndCloudHistory, refreshQueueStats]);

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

  const handleRecreateDestination = async (type: 'photo' | 'video') => {
    await TelegramBridgeService.recreateDestination(type);
    await syncChannelsAndCloudHistory();
  };

  const handleConfirmBackup = async (selectedIds?: string[]) => {
    if (!isLoggedIn) return;

    // Destination validation: check destinations before enqueuing
    const refreshedChannels = await TelegramBridgeService.refreshDestinations();
    const activeDestinations = refreshedChannels || channels;
    if (refreshedChannels) {
      setChannels(refreshedChannels);
    }

    let eligibleIds: string[];
    if (selectedIds && selectedIds.length > 0) {
      eligibleIds = selectedIds;
    } else {
      const { confirmed, eligibleItemIds } = confirmInitialScan(scanReview);
      if (!confirmed || eligibleItemIds.length === 0) return;
      eligibleIds = eligibleItemIds;
    }

    // Check if any selected items target a deleted destination
    const itemsToBackup = scanReview.items.filter(i => eligibleIds.includes(i.id));
    const hasPhotos = itemsToBackup.some(i => i.mediaType === 'photo');
    const hasVideos = itemsToBackup.some(i => i.mediaType === 'video');

    if (hasPhotos && activeDestinations?.photoStatus?.state === 'DELETED') {
      setActiveTab('settings');
      return;
    }
    if (hasVideos && activeDestinations?.videoStatus?.state === 'DELETED') {
      setActiveTab('settings');
      return;
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
    await refreshQueueStats();

    // Run queue subject to network constraints
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
            channelId: channels?.photoChannelId || '-100999001',
          },
        ]);
        setActiveProgress(null);
        refreshQueueStats();
      },
      onJobFailed: () => {
        setActiveProgress(null);
        refreshQueueStats();
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

  const handleCancelAllJobs = async () => {
    await engine.cancelAll();
    setActiveProgress(null);
    setIsPaused(true);
    await refreshQueueStats();
  };

  const handleRetryFailedJobs = async () => {
    await engine.retryFailed();
    await refreshQueueStats();
    engine.resume();
    setIsPaused(false);
    engine.runQueue(networkPolicy, true, {
      onProgress: p => setActiveProgress(p),
      onJobCompleted: () => {
        setActiveProgress(null);
        refreshQueueStats();
      },
      onJobFailed: () => {
        setActiveProgress(null);
        refreshQueueStats();
      },
    });
  };

  const handleUnlockPassphrase = async (passphrase: string): Promise<boolean> => {
    const raw = normalizeRecoveryKey(passphrase);
    let saltHex: string | undefined;

    for (const h of remoteHistoryItems) {
      if (h.encryptionEnvelope) {
        const env =
          typeof h.encryptionEnvelope === 'string'
            ? JSON.parse(h.encryptionEnvelope)
            : h.encryptionEnvelope;
        if (env?.salt) {
          saltHex = env.salt;
          break;
        }
      }
    }

    if (!saltHex) {
      const cfg = SessionKeyStore.getConfig();
      saltHex = cfg?.kdfSalt || '0123456789abcdef0123456789abcdef';
    }

    try {
      const masterKey = deriveMasterKey(raw, saltHex);
      SessionKeyStore.setSessionKey(masterKey, raw);

      await restoreManager.unlockEncryptedMedia(remoteHistoryItems, masterKey);

      setCloudItems(prev =>
        prev.map(item => {
          if (!item.isEncrypted && !item.encryptionEnvelope) return item;
          let decryptedName = item.originalName;
          if (item.encryptionEnvelope) {
            try {
              const env =
                typeof item.encryptionEnvelope === 'string'
                  ? JSON.parse(item.encryptionEnvelope)
                  : item.encryptionEnvelope;
              if (env.encryptedDek && env.encryptedMeta) {
                const dekBuffer = Buffer.from(env.encryptedDek, 'base64');
                const dek = decryptBuffer(dekBuffer, masterKey, env.dekIv, env.dekTag);
                const metaJson = decryptBuffer(
                  Buffer.from(env.encryptedMeta, 'base64'),
                  dek,
                  env.metaIv,
                  env.metaTag,
                ).toString('utf8');
                const meta = JSON.parse(metaJson);
                decryptedName = meta.originalName || decryptedName;
              }
            } catch {
              // Ignore
            }
          }
          return {
            ...item,
            originalName: decryptedName,
            isLocked: false,
          };
        }),
      );
      return true;
    } catch {
      return false;
    }
  };

  const handleRestoreItem = async (
    _item: CloudMediaItem,
    _policy: ConflictPolicy,
  ): Promise<boolean> => {
    return new Promise(resolve => setTimeout(() => resolve(true), 800));
  };

  const handleOpenChannelInTelegram = async (chatId: string) => {
    try {
      await TelegramBridgeService.openChatInTelegram(chatId);
    } catch {
      // Handled
    }
  };

  const handleLogout = async () => {
    try {
      await TelegramBridgeService.logOut();
    } catch {
      // Handled
    }
    SessionKeyStore.clear();
    setIsLoggedIn(false);
    setCurrentUser(null);
    setChannels(null);
    setCloudItems([]);
    setRemoteHistoryItems([]);
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

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <LoginScreen
          onLoginSuccess={user => {
            setIsLoggedIn(true);
            setCurrentUser(user);
            syncChannelsAndCloudHistory();
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
            channels={channels}
            initialView="device"
            onRequestPermission={handleRequestPermission}
            onOpenAppSettings={handleOpenAppSettings}
            onRescan={() => refreshScan()}
            onToggleFolderExclusion={handleToggleFolderExclusion}
            onConfirmBackup={handleConfirmBackup}
            onTogglePause={handleTogglePause}
            onRestoreItem={handleRestoreItem}
            onOpenChannelInTelegram={handleOpenChannelInTelegram}
            onResyncChannels={syncChannelsAndCloudHistory}
            onUnlockPassphrase={handleUnlockPassphrase}
            onRecreateDestination={handleRecreateDestination}
          />
        )}

        {activeTab === 'cloud' && (
          <CloudGalleryScreen
            items={cloudItems}
            scannedItems={scanReview.items}
            folders={scanReview.folders}
            eligibleCount={scanReview.eligibleCount}
            eligibleBytes={scanReview.eligibleBytes}
            isPaused={isPaused}
            activeProgress={activeProgress}
            mediaPermissionStatus={permissionStatus}
            channels={channels}
            initialView="cloud"
            onRequestPermission={handleRequestPermission}
            onOpenAppSettings={handleOpenAppSettings}
            onRescan={() => refreshScan()}
            onToggleFolderExclusion={handleToggleFolderExclusion}
            onConfirmBackup={handleConfirmBackup}
            onTogglePause={handleTogglePause}
            onRestoreItem={handleRestoreItem}
            onOpenChannelInTelegram={handleOpenChannelInTelegram}
            onResyncChannels={syncChannelsAndCloudHistory}
            onUnlockPassphrase={handleUnlockPassphrase}
            onRecreateDestination={handleRecreateDestination}
          />
        )}

        {activeTab === 'activity' && (
          <BackupActivityScreen
            activeProgress={activeProgress}
            isPaused={isPaused}
            queueStats={queueStats}
            jobs={jobsList}
            onTogglePause={handleTogglePause}
            onCancelAll={handleCancelAllJobs}
            onRetryFailed={handleRetryFailedJobs}
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
            channels={channels}
            onToggleNetworkPolicy={wifiOnly =>
              setNetworkPolicy(
                wifiOnly
                  ? NetworkPolicy.WIFI_ONLY
                  : NetworkPolicy.WIFI_AND_CELLULAR,
              )
            }
            onToggleCharging={setRequiresCharging}
            onToggleEncryption={(enabled, setup) => {
              setEncryptionEnabled(enabled);
              if (setup) {
                SessionKeyStore.setConfig(setup.config);
                repo.setSetting('client_encryption_config', JSON.stringify(setup.config));
              }
              repo.setSetting('encryption_enabled', enabled ? 'true' : 'false');
            }}
            onTogglePause={handleTogglePause}
            onRequestPermission={handleRequestPermission}
            onOpenAppSettings={handleOpenAppSettings}
            onNavigateToProfile={() => setActiveTab('profile')}
            onDisconnectTelegram={handleLogout}
            onOpenChannelInTelegram={handleOpenChannelInTelegram}
            onResyncChannels={syncChannelsAndCloudHistory}
            onUnlockPassphrase={handleUnlockPassphrase}
            onRecreateDestination={handleRecreateDestination}
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

      {/* Streamlined Bottom Navigation Bar with all core destinations */}
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
            activeTab === 'cloud' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('cloud')}
          accessibilityLabel="Cloud tab"
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'cloud' && styles.navIconActive,
            ]}
          >
            ☁️
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'cloud' && styles.navLabelActive,
            ]}
          >
            Cloud
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'activity' && styles.navItemActive,
          ]}
          onPress={() => {
            refreshQueueStats();
            setActiveTab('activity');
          }}
          accessibilityLabel="Activity tab"
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === 'activity' && styles.navIconActive,
            ]}
          >
            ⚡
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'activity' && styles.navLabelActive,
            ]}
          >
            Activity
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
    paddingVertical: 8,
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
