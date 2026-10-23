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
import {
  NetworkPolicy,
  ConflictPolicy,
  MediaState,
} from '../domain/backup/stateMachine';
import { TelegramBackupChannels, TelegramHistoryItem } from '../types/telegram';
import { RestoreManager } from '../domain/restore/restoreManager';
import {
  SessionKeyStore,
  deriveMasterKeyAsync,
  normalizeRecoveryKey,
  decryptBuffer,
  loadPersistedMasterKey,
  persistMasterKeySecurely,
  clearPersistedMasterKey,
  verifyMasterKeyAgainstConfig,
} from '../domain/crypto/encryptionService';
import { DbUploadJob } from '../domain/database/types';
import { EncryptionConfig } from '../types/encryption';

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
  const channelsRef = useRef<TelegramBackupChannels | null>(null);
  channelsRef.current = channels;

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
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(false);
  const [autoBackupIncludePhotos, setAutoBackupIncludePhotos] = useState<boolean>(true);
  const [autoBackupIncludeVideos, setAutoBackupIncludeVideos] = useState<boolean>(true);
  const [syncFreshnessState, setSyncFreshnessState] = useState<
    'synced' | 'syncing' | 'offline' | 'error'
  >('synced');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [keyRecoveryNotice, setKeyRecoveryNotice] = useState<string | null>(null);
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

  // Helper to paginate full channel history from Telegram
  const fetchAllChannelHistory = async (
    chatId: string,
    maxTotal: number = 2000,
  ): Promise<TelegramHistoryItem[]> => {
    const all: TelegramHistoryItem[] = [];
    let fromMessageId = '0';
    const batchSize = 100;

    while (all.length < maxTotal) {
      const batch = await TelegramBridgeService.getChannelHistory(
        chatId,
        batchSize,
        fromMessageId,
      );
      if (!batch || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < batchSize) break;
      const last = batch[batch.length - 1];
      if (last.messageId === fromMessageId) break;
      fromMessageId = last.messageId;
    }
    return all;
  };

  // Synchronize Telegram Backup Channels and Remote Cloud History
  // Strictly enforces that Telegram channel contents are the authoritative source of truth.
  const syncChannelsAndCloudHistory = useCallback(async () => {
    if (isSyncingDestinationsRef.current) return;
    isSyncingDestinationsRef.current = true;
    setSyncFreshnessState('syncing');
    setSyncError(null);
    try {
      let ch = await TelegramBridgeService.refreshDestinations();
      if (!ch) {
        try {
          ch = await TelegramBridgeService.setupChannels();
        } catch (setupErr: any) {
          setChannels({
            photoChannelId: '0',
            photoChannelTitle: 'Backup - Photos',
            videoChannelId: '0',
            videoChannelTitle: 'Backup - Videos',
            verified: false,
            photoStatus: {
              channelId: '0',
              title: 'Backup - Photos',
              state: 'NEEDS_SETUP',
              errorMessage: setupErr?.message || 'Destinations need setup',
            },
            videoStatus: {
              channelId: '0',
              title: 'Backup - Videos',
              state: 'NEEDS_SETUP',
              errorMessage: setupErr?.message || 'Destinations need setup',
            },
          });
          setSyncFreshnessState('error');
          setSyncError(setupErr?.message || 'Destinations need setup');
          return;
        }
      }
      setChannels(ch);

      // Paginate complete remote history across both channels
      const photoHistory = await fetchAllChannelHistory(ch.photoChannelId);
      const videoHistory = await fetchAllChannelHistory(ch.videoChannelId);
      const allHistory = [...photoHistory, ...videoHistory];
      setRemoteHistoryItems(allHistory);

      // Reconcile local database cache: remove stale objects absent from remote channels
      const photoMsgIds = new Set(photoHistory.map(h => h.messageId));
      const videoMsgIds = new Set(videoHistory.map(h => h.messageId));
      await repo.reconcileTelegramObjects(ch.photoChannelId, photoMsgIds);
      await repo.reconcileTelegramObjects(ch.videoChannelId, videoMsgIds);

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

      // Auto-recover client_encryption_config from remote history if local config was cleared
      if (!SessionKeyStore.getConfig()) {
        for (const h of allHistory) {
          if (h.encryptionEnvelope) {
            const env =
              typeof h.encryptionEnvelope === 'string'
                ? JSON.parse(h.encryptionEnvelope)
                : h.encryptionEnvelope;
            if (env?.salt && env?.verificationToken) {
              const restoredCfg: EncryptionConfig = {
                enabled: true,
                keyVersion: env.keyVersion || 1,
                kdfSalt: env.salt,
                kdfIterations: 100000,
                verificationToken: env.verificationToken,
                verifiedAtMs: h.modifiedAtMs || Date.now(),
              };
              SessionKeyStore.setConfig(restoredCfg);
              await repo.setSetting('client_encryption_config', JSON.stringify(restoredCfg));
              await repo.setSetting('encryption_enabled', 'true');
              setEncryptionEnabled(true);
              break;
            }
          }
        }
      }

      // Authoritative remote state: if channel is empty, cloud gallery is empty!
      setCloudItems(mapped);
      setSyncFreshnessState('synced');
      setSyncError(null);
    } catch (err: any) {
      setSyncFreshnessState('error');
      setSyncError(err?.message || 'Failed to synchronize with Telegram channels.');
    } finally {
      isSyncingDestinationsRef.current = false;
    }
  }, [restoreManager, repo]);

  // Restore persisted encryption configuration and Keystore master key on startup
  useEffect(() => {
    const loadPersistedSettings = async () => {
      try {
        const savedConfigStr = await repo.getSetting('client_encryption_config');
        let cfg: EncryptionConfig | null = null;
        if (savedConfigStr) {
          cfg = JSON.parse(savedConfigStr);
          SessionKeyStore.setConfig(cfg!);
        }
        const savedEnc = await repo.getSetting('encryption_enabled');
        if (savedEnc === 'true') {
          setEncryptionEnabled(true);
          // Attempt to restore master key from Keystore-backed secure storage
          try {
            const persistedKey = await loadPersistedMasterKey();
            if (persistedKey && cfg) {
              const isValid = verifyMasterKeyAgainstConfig(persistedKey, cfg);
              if (isValid) {
                SessionKeyStore.setSessionKey(persistedKey, undefined, cfg);
              } else {
                await clearPersistedMasterKey();
                setKeyRecoveryNotice(
                  'Persisted encryption key verification failed. Please enter your recovery passphrase.',
                );
              }
            }
          } catch (keystoreErr: any) {
            setKeyRecoveryNotice(
              `Device secure storage was reset or invalidated (${keystoreErr?.message || 'Keystore error'}). Please enter your 12-word recovery passphrase to re-enable secure unlock.`,
            );
          }
        }

        const autoBackupStr = await repo.getSetting('auto_backup_enabled');
        if (autoBackupStr !== null && autoBackupStr !== '') {
          setAutoBackupEnabled(autoBackupStr === 'true');
        }
        const autoPhotosStr = await repo.getSetting('auto_backup_include_photos');
        if (autoPhotosStr !== null && autoPhotosStr !== '') {
          setAutoBackupIncludePhotos(autoPhotosStr === 'true');
        }
        const autoVideosStr = await repo.getSetting('auto_backup_include_videos');
        if (autoVideosStr !== null && autoVideosStr !== '') {
          setAutoBackupIncludeVideos(autoVideosStr === 'true');
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
        let destChannelId =
          item.mediaType === 'video'
            ? channelsRef.current?.videoChannelId
            : channelsRef.current?.photoChannelId;

        // If channel destination is not established yet, create/setup channels
        if (!destChannelId || destChannelId === '0') {
          const fresh = await TelegramBridgeService.setupChannels();
          if (fresh) {
            setChannels(fresh);
            destChannelId =
              item.mediaType === 'video'
                ? fresh.videoChannelId
                : fresh.photoChannelId;
          }
        }

        if (!destChannelId || destChannelId === '0') {
          throw new Error(`No destination Telegram channel available for ${item.mediaType}`);
        }

        // Encryption check: fail fast if enabled but locked to prevent any plaintext leak
        const isEncUnlocked = SessionKeyStore.isUnlocked();
        const cfg = SessionKeyStore.getConfig();
        const encActive = cfg?.enabled ?? false;

        if (encActive && !isEncUnlocked) {
          throw new Error('Client encryption is enabled but session key is locked. Unlock encryption before uploading.');
        }

        const isEncrypted = encActive && isEncUnlocked;
        let masterKeyHex = '';
        let saltHex = '';
        let verificationToken = '';

        if (isEncrypted) {
          const masterKey = SessionKeyStore.getSessionKey();
          if (!masterKey) {
            throw new Error('Active master encryption key is unavailable.');
          }
          masterKeyHex = masterKey.toString('hex');
          saltHex = cfg?.kdfSalt || '';
          verificationToken = cfg?.verificationToken || '';
        }

        const metadataPayload = {
          schemaVersion: 1,
          app: 'telegram-gallery-backup',
          mediaId: item.id,
          mediaType: item.mediaType,
          originalName: item.displayName,
          relativePath: item.relativePath || '',
          mimeType:
            item.mimeType ||
            (item.mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
          sizeBytes: item.sizeBytes,
          modifiedAtMs: item.modifiedAtMs,
          contentHash: item.contentHash || null,
          saltHex,
          verificationToken,
        };

        const uploadUri = item.sourceKey || item.id;

        const uploadResult = await TelegramBridgeService.uploadMedia(
          destChannelId,
          uploadUri,
          item.mediaType,
          JSON.stringify(metadataPayload),
          isEncrypted,
          masterKeyHex,
        );

        return {
          channelId: uploadResult.channelId,
          messageId: uploadResult.messageId,
          contentHash: uploadResult.contentHash || item.contentHash,
        };
      },
      async item => {
        try {
          const destChannelId =
            item.mediaType === 'video'
              ? channelsRef.current?.videoChannelId
              : channelsRef.current?.photoChannelId;
          if (!destChannelId || destChannelId === '0') return null;
          const history = await TelegramBridgeService.getChannelHistory(
            destChannelId,
            50,
            '0',
          );
          const matched = history.find(
            h =>
              h.mediaId === item.id ||
              (item.contentHash && h.contentHash === item.contentHash),
          );
          if (matched) {
            return { channelId: destChannelId, messageId: matched.messageId };
          }
        } catch {
          // Best effort
        }
        return null;
      },
    );
  }, [repo]);

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

  // Automatic Backup Processor
  const runAutoBackup = useCallback(async () => {
    if (!autoBackupEnabled || !isLoggedIn) return;
    try {
      const perm = await checkPermissionState();
      if (perm !== 'granted' && perm !== 'partial') return;

      const review = await MediaScannerService.scanMediaStore([]);
      const newEligibleIds: string[] = [];

      for (const item of review.items) {
        if (item.isExcluded) continue;
        if (item.mediaType === 'photo' && !autoBackupIncludePhotos) continue;
        if (item.mediaType === 'video' && !autoBackupIncludeVideos) continue;

        const existing = await repo.getMediaItem(item.id);
        if (
          existing &&
          (existing.state === MediaState.BACKED_UP ||
            existing.state === MediaState.QUEUED ||
            existing.state === MediaState.UPLOADING)
        ) {
          continue;
        }

        const tgObj = await repo.getTelegramObjectForMedia(item.id);
        if (tgObj) continue;

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
          state: MediaState.DISCOVERED,
          isExcluded: false,
          lastScannedAtMs: Date.now(),
          createdAtMsLocal: Date.now(),
          updatedAtMsLocal: Date.now(),
        });
        newEligibleIds.push(item.id);
      }

      if (newEligibleIds.length === 0) return;

      if (encryptionEnabled && !SessionKeyStore.isUnlocked()) {
        return;
      }

      await engine.queueMediaForBackup(newEligibleIds);
      await refreshQueueStats();

      engine.runQueue(networkPolicy, true, {
        onProgress: p => setActiveProgress(p),
        onJobCompleted: async (_job, media) => {
          const tgObj = await repo.getTelegramObjectForMedia(media.id);
          const destChan =
            media.mediaType === 'video'
              ? channelsRef.current?.videoChannelId || ''
              : channelsRef.current?.photoChannelId || '';

          setCloudItems(prev => {
            if (prev.some(p => p.id === media.id)) return prev;
            return [
              ...prev,
              {
                id: media.id,
                sourceKey: media.sourceKey || undefined,
                mediaType: media.mediaType,
                originalName: media.displayName,
                relativePath: media.relativePath || 'DCIM/Camera',
                sizeBytes: media.sizeBytes,
                modifiedAtMs: media.modifiedAtMs,
                messageId: tgObj?.messageId || '1',
                channelId: tgObj?.channelId || destChan,
              },
            ];
          });
          await refreshQueueStats();
        },
      });
    } catch (err) {
      console.warn('Auto-backup check failed:', err);
    }
  }, [
    autoBackupEnabled,
    autoBackupIncludePhotos,
    autoBackupIncludeVideos,
    isLoggedIn,
    checkPermissionState,
    repo,
    encryptionEnabled,
    engine,
    refreshQueueStats,
    networkPolicy,
  ]);

  const handleToggleAutoBackup = useCallback(
    async (enabled: boolean) => {
      setAutoBackupEnabled(enabled);
      await repo.setSetting('auto_backup_enabled', enabled ? 'true' : 'false');
      if (enabled) {
        runAutoBackup();
      }
    },
    [repo, runAutoBackup],
  );

  const handleToggleAutoBackupPhotos = useCallback(
    async (include: boolean) => {
      setAutoBackupIncludePhotos(include);
      await repo.setSetting(
        'auto_backup_include_photos',
        include ? 'true' : 'false',
      );
      if (include && autoBackupEnabled) {
        runAutoBackup();
      }
    },
    [repo, autoBackupEnabled, runAutoBackup],
  );

  const handleToggleAutoBackupVideos = useCallback(
    async (include: boolean) => {
      setAutoBackupIncludeVideos(include);
      await repo.setSetting(
        'auto_backup_include_videos',
        include ? 'true' : 'false',
      );
      if (include && autoBackupEnabled) {
        runAutoBackup();
      }
    },
    [repo, autoBackupEnabled, runAutoBackup],
  );

  const handleLockEncryption = useCallback(async () => {
    await SessionKeyStore.lockEncryption();
    setCloudItems(prev =>
      prev.map(item => ({
        ...item,
        isLocked: item.isEncrypted,
        originalName: item.isEncrypted
          ? 'Encrypted Item (Locked)'
          : item.originalName,
      })),
    );
  }, []);

  const handleDeleteLocalMedia = useCallback(
    async (sourceKey: string): Promise<boolean> => {
      try {
        const success = await MediaScannerService.deleteLocalMedia(sourceKey);
        if (success) {
          const item = await repo.findMediaItemBySourceKey(sourceKey);
          if (item) {
            await repo.deleteMediaItem(item.id);
          }
          await refreshScan();
        }
        return success;
      } catch {
        return false;
      }
    },
    [repo, refreshScan],
  );

  const handleDeleteCloudMedia = useCallback(
    async (
      itemsToDelete: CloudMediaItem[],
    ): Promise<{ successCount: number; failedCount: number }> => {
      let successCount = 0;
      let failedCount = 0;

      const channelMap = new Map<string, string[]>();
      for (const item of itemsToDelete) {
        const arr = channelMap.get(item.channelId) || [];
        arr.push(item.messageId);
        channelMap.set(item.channelId, arr);
      }

      for (const [channelId, messageIds] of channelMap.entries()) {
        try {
          const ok = await TelegramBridgeService.deleteMessages(
            channelId,
            messageIds,
          );
          if (ok) {
            successCount += messageIds.length;
            for (const msgId of messageIds) {
              await repo.deleteTelegramObject(channelId, msgId);
            }
          } else {
            failedCount += messageIds.length;
          }
        } catch {
          failedCount += messageIds.length;
        }
      }

      await syncChannelsAndCloudHistory();
      return { successCount, failedCount };
    },
    [repo, syncChannelsAndCloudHistory],
  );

  // Sync permissions, initial scan, and automatic backup on login transition
  useEffect(() => {
    if (isLoggedIn) {
      checkPermissionState().then(status => {
        if (status === 'granted' || status === 'partial') {
          refreshScan();
          runAutoBackup();
        }
      });
      syncChannelsAndCloudHistory();
      refreshQueueStats();
    }
  }, [isLoggedIn]);

  // Refresh permissions, scan, and trigger auto-backup when returning to foreground
  useEffect(() => {
    let lastChecked = 0;
    const subscription = AppState.addEventListener('change', nextAppState => {
      const now = Date.now();
      if (nextAppState === 'active' && isLoggedIn && now - lastChecked > 3000) {
        lastChecked = now;
        checkPermissionState().then(status => {
          if (status === 'granted' || status === 'partial') {
            refreshScan();
            runAutoBackup();
          }
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isLoggedIn, checkPermissionState, refreshScan, runAutoBackup]);

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

  const handleSetupDestinations = useCallback(async () => {
    const ch = await TelegramBridgeService.setupChannels();
    setChannels(ch);
    await syncChannelsAndCloudHistory();
  }, [syncChannelsAndCloudHistory]);

  const handleConfirmBackup = async (selectedIds?: string[]) => {
    if (!isLoggedIn) return;

    // Destination validation: check destinations before enqueuing
    let refreshedChannels = await TelegramBridgeService.refreshDestinations();
    if (
      !refreshedChannels?.photoChannelId ||
      !refreshedChannels?.videoChannelId ||
      refreshedChannels.photoChannelId === '0' ||
      refreshedChannels.videoChannelId === '0'
    ) {
      const setupResult = await TelegramBridgeService.setupChannels();
      if (setupResult) {
        refreshedChannels = setupResult;
      }
    }
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
      onJobCompleted: async (_job, media) => {
        const tgObj = await repo.getTelegramObjectForMedia(media.id);
        const destChan =
          media.mediaType === 'video'
            ? channels?.videoChannelId || ''
            : channels?.photoChannelId || '';

        setCloudItems(prev => {
          if (prev.some(p => p.id === media.id)) return prev;
          return [
            ...prev,
            {
              id: media.id,
              sourceKey: media.sourceKey || undefined,
              mediaType: media.mediaType,
              originalName: media.displayName,
              relativePath: media.relativePath || 'DCIM/Camera',
              sizeBytes: media.sizeBytes,
              modifiedAtMs: media.modifiedAtMs,
              messageId: tgObj?.messageId || '1',
              channelId: tgObj?.channelId || destChan,
            },
          ];
        });
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
      const masterKey = await deriveMasterKeyAsync(raw, saltHex);
      SessionKeyStore.setSessionKey(masterKey, raw);
      await persistMasterKeySecurely(masterKey.toString('hex'));
      setKeyRecoveryNotice(null);

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
      runAutoBackup();
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
    await SessionKeyStore.lockEncryption();
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
        {keyRecoveryNotice && (
          <View style={styles.keyRecoveryBanner} testID="key-recovery-notice">
            <Text style={styles.keyRecoveryBannerText}>
              ⚠️ {keyRecoveryNotice}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setKeyRecoveryNotice(null);
                setActiveTab('settings');
              }}
              style={styles.keyRecoveryActionBtn}
            >
              <Text style={styles.keyRecoveryActionText}>Unlock</Text>
            </TouchableOpacity>
          </View>
        )}

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
            onSetupDestinations={handleSetupDestinations}
            syncFreshnessState={syncFreshnessState}
            syncError={syncError}
            onDeleteLocalMedia={handleDeleteLocalMedia}
            onDeleteCloudMedia={handleDeleteCloudMedia}
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
            onSetupDestinations={handleSetupDestinations}
            syncFreshnessState={syncFreshnessState}
            syncError={syncError}
            onDeleteLocalMedia={handleDeleteLocalMedia}
            onDeleteCloudMedia={handleDeleteCloudMedia}
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
            autoBackupEnabled={autoBackupEnabled}
            autoBackupIncludePhotos={autoBackupIncludePhotos}
            autoBackupIncludeVideos={autoBackupIncludeVideos}
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
            onToggleAutoBackup={handleToggleAutoBackup}
            onToggleAutoBackupIncludePhotos={handleToggleAutoBackupPhotos}
            onToggleAutoBackupIncludeVideos={handleToggleAutoBackupVideos}
            onLockEncryption={handleLockEncryption}
            onTogglePause={handleTogglePause}
            onRequestPermission={handleRequestPermission}
            onOpenAppSettings={handleOpenAppSettings}
            onNavigateToProfile={() => setActiveTab('profile')}
            onDisconnectTelegram={handleLogout}
            onOpenChannelInTelegram={handleOpenChannelInTelegram}
            onResyncChannels={syncChannelsAndCloudHistory}
            onUnlockPassphrase={handleUnlockPassphrase}
            onRecreateDestination={handleRecreateDestination}
            onSetupDestinations={handleSetupDestinations}
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
  keyRecoveryBanner: {
    backgroundColor: '#3b1c1c',
    borderColor: '#b91c1c',
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  keyRecoveryBannerText: {
    color: '#fca5a5',
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  keyRecoveryActionBtn: {
    backgroundColor: '#dc2626',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  keyRecoveryActionText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});
