import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  FlatList,
  TextInput,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Buffer } from 'buffer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConflictPolicy } from '../domain/backup/stateMachine';
import { BackupTransferProgress } from '../domain/backup/engine';
import { MediaPermissionStatus } from '../domain/permissions/permissionService';
import { TelegramBackupChannels } from '../types/telegram';
import { TelegramBridgeService } from '../native/TelegramBridge';
import {
  SessionKeyStore,
  verifyPassphraseAgainstItem,
  verifyRecoveryKey,
  normalizeRecoveryKey,
} from '../domain/crypto/encryptionService';
import { EncryptedItemEnvelope } from '../types/encryption';
import { InAppVideoPlayer } from '../components/InAppVideoPlayer';

const defaultInsets = { top: 16, bottom: 16, left: 0, right: 0 };
function useSafeInsetsFallback() {
  try {
    const insets = useSafeAreaInsets();
    return insets || defaultInsets;
  } catch {
    return defaultInsets;
  }
}

const SCREEN_WIDTH = Dimensions.get('window').width;

export interface CloudMediaItem {
  id: string;
  mediaType: 'photo' | 'video';
  originalName: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  messageId: string;
  channelId: string;
  fileId?: number;
  isEncrypted?: boolean;
  isLocked?: boolean;
  encryptionEnvelope?: EncryptedItemEnvelope | string | null;
}

export interface DiscoveredMediaItem {
  id: string;
  sourceKey: string;
  mediaType: 'photo' | 'video';
  displayName: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  isExcluded?: boolean;
}

export interface FolderSummaryItem {
  folderKey: string;
  displayLabel: string;
  itemCount: number;
  byteSize: number;
  isExcluded: boolean;
}

export interface CloudGalleryScreenProps {
  items: CloudMediaItem[];
  scannedItems?: DiscoveredMediaItem[];
  folders?: FolderSummaryItem[];
  eligibleCount?: number;
  eligibleBytes?: number;
  isPaused?: boolean;
  activeProgress?: BackupTransferProgress | null;
  mediaPermissionStatus?: MediaPermissionStatus;
  channels?: TelegramBackupChannels | null;
  initialView?: 'device' | 'cloud';
  onRequestPermission?: () => void;
  onOpenAppSettings?: () => void;
  onRescan?: () => void;
  onToggleFolderExclusion?: (folderKey: string) => void;
  onConfirmBackup?: (selectedIds?: string[]) => void;
  onTogglePause?: () => void;
  onRestoreItem: (
    item: CloudMediaItem,
    policy: ConflictPolicy,
  ) => Promise<boolean>;
  onOpenChannelInTelegram?: (channelId: string) => void;
  onResyncChannels?: () => void;
  onUnlockPassphrase?: (passphrase: string) => Promise<boolean>;
  onRecreateDestination?: (type: 'photo' | 'video') => Promise<void>;
  syncFreshnessState?: 'synced' | 'syncing' | 'offline' | 'error';
}

export const CloudGalleryScreen: React.FC<CloudGalleryScreenProps> = ({
  items,
  scannedItems = [],
  folders: _folders = [],
  eligibleCount: _eligibleCount = 0,
  eligibleBytes: _eligibleBytes = 0,
  isPaused: _isPaused = false,
  activeProgress: _activeProgress = null,
  mediaPermissionStatus = 'granted',
  channels = null,
  initialView = 'device',
  onRequestPermission,
  onOpenAppSettings,
  onRescan,
  onToggleFolderExclusion: _onToggleFolderExclusion,
  onConfirmBackup,
  onTogglePause: _onTogglePause,
  onRestoreItem,
  onOpenChannelInTelegram,
  onResyncChannels,
  onUnlockPassphrase,
  onRecreateDestination,
  syncFreshnessState = 'synced',
}) => {
  // Navigation View: 'device' (Local Gallery) or 'cloud' (Telegram Cloud Backups)
  const [activeView, setActiveView] = useState<'device' | 'cloud'>(initialView);

  // Layout Toggle: exactly 1-column or 2-column thumbnail view
  const [columnCount, setColumnCount] = useState<1 | 2>(2);

  // Filter chips: 'all' | 'photo' | 'video'
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>('all');

  // Multi-Selection State for Backup
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // In-App Full-Screen Viewer State & Safe-Area Aware Playback Lifecycle
  const insets = useSafeInsetsFallback();
  const [previewItem, setPreviewItem] = useState<
    DiscoveredMediaItem | CloudMediaItem | null
  >(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoLoadingMsg, setVideoLoadingMsg] = useState<string>('');
  const [playableVideoUri, setPlayableVideoUri] = useState<string>('');
  const [activeTempVideoPath, setActiveTempVideoPath] = useState<string | null>(null);

  // Destination Recreation Modal State
  const [showRecreateModal, setShowRecreateModal] = useState<boolean>(false);
  const [recreateTarget, setRecreateTarget] = useState<'photo' | 'video' | null>(null);
  const [isRecreating, setIsRecreating] = useState<boolean>(false);
  const [recreateError, setRecreateError] = useState<string | null>(null);

  const handleCloseViewer = async () => {
    setPreviewItem(null);
    setPlayableVideoUri('');
    setVideoError(null);
    setVideoLoadingMsg('');
    if (activeTempVideoPath) {
      const p = activeTempVideoPath;
      setActiveTempVideoPath(null);
      await TelegramBridgeService.cleanupTempMedia(p);
    }
  };

  const prepareVideoSource = useCallback(async (item: DiscoveredMediaItem | CloudMediaItem) => {
    setVideoLoadingMsg('Preparing in-app video...');
    setVideoError(null);
    setPlayableVideoUri('');

    try {
      if ('sourceKey' in item && item.sourceKey) {
        setPlayableVideoUri(item.sourceKey);
        return;
      }

      if ('fileId' in item && item.fileId) {
        const isEncrypted = !!item.isEncrypted;
        let masterKeyHex = '';

        if (isEncrypted) {
          const key = SessionKeyStore.getSessionKey();
          if (!key) {
            setShowUnlockModal(true);
            setVideoError('Encryption key required to decrypt video.');
            return;
          }
          masterKeyHex = key.toString('hex');
          setVideoLoadingMsg('Decrypting video media...');
        } else {
          setVideoLoadingMsg('Downloading from Telegram...');
        }

        const envelopeStr =
          typeof item.encryptionEnvelope === 'object'
            ? JSON.stringify(item.encryptionEnvelope)
            : item.encryptionEnvelope || '{}';

        const prepared = await TelegramBridgeService.prepareCloudVideo(
          item.fileId,
          isEncrypted,
          envelopeStr,
          masterKeyHex,
        );

        setPlayableVideoUri(prepared.localUri);
        if (prepared.isTemporary && prepared.tempFilePath) {
          setActiveTempVideoPath(prepared.tempFilePath);
        }
      } else {
        throw new Error('Video source reference is unavailable.');
      }
    } catch (err: any) {
      setVideoError(err?.message || 'Video preparation failed.');
    }
  }, []);

  useEffect(() => {
    if (previewItem && previewItem.mediaType === 'video') {
      prepareVideoSource(previewItem);
    } else {
      setPlayableVideoUri('');
      setVideoError(null);
      setVideoLoadingMsg('');
    }
  }, [previewItem, prepareVideoSource]);

  const handleRetryVideoPreparation = () => {
    if (previewItem && previewItem.mediaType === 'video') {
      prepareVideoSource(previewItem);
    }
  };

  const handlePromptRecreate = (type: 'photo' | 'video') => {
    setRecreateTarget(type);
    setRecreateError(null);
    setShowRecreateModal(true);
  };

  const handleConfirmRecreate = async () => {
    if (!recreateTarget) return;
    setIsRecreating(true);
    setRecreateError(null);
    try {
      if (onRecreateDestination) {
        await onRecreateDestination(recreateTarget);
      } else {
        await TelegramBridgeService.recreateDestination(recreateTarget);
        onResyncChannels?.();
      }
      setShowRecreateModal(false);
      setRecreateTarget(null);
    } catch (err: any) {
      setRecreateError(err?.message || 'Failed to recreate destination.');
    } finally {
      setIsRecreating(false);
    }
  };

  // Unlock Recovery Modal State
  const [showUnlockModal, setShowUnlockModal] = useState<boolean>(false);
  const [passphraseInput, setPassphraseInput] = useState<string>('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockSuccess, setUnlockSuccess] = useState<string | null>(null);
  const [isVerifyingKey, setIsVerifyingKey] = useState<boolean>(false);

  // Restore Modal State
  const [restoreModalItem, setRestoreModalItem] = useState<CloudMediaItem | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<ConflictPolicy>(
    ConflictPolicy.KEEP_BOTH,
  );
  const [restoring, setRestoring] = useState<boolean>(false);
  const [restoreStatus, setRestoreStatus] = useState<string>('');

  // Thumbnail load error tracking
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (ms: number): string => {
    if (!ms) return 'Unknown date';
    return new Date(ms).toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Backed-up ID set for fast status lookups
  const backedUpIdSet = useMemo(() => new Set(items.map(ci => ci.id)), [items]);

  // Locked encrypted items detection
  const isUnlocked = SessionKeyStore.isUnlocked();
  const lockedItemsCount = useMemo(() => {
    return items.filter(i => {
      const isEnc = i.isEncrypted || !!i.encryptionEnvelope;
      return isEnc && (!isUnlocked || i.isLocked);
    }).length;
  }, [items, isUnlocked]);

  // Filtered device media items
  const filteredDeviceItems = useMemo(() => {
    return scannedItems.filter(item => {
      if (filterType !== 'all' && item.mediaType !== filterType) return false;
      return true;
    });
  }, [scannedItems, filterType]);

  // Filtered cloud media items
  const filteredCloudItems = useMemo(() => {
    return items.filter(item => {
      if (filterType !== 'all' && item.mediaType !== filterType) return false;
      return true;
    });
  }, [items, filterType]);

  // Selection calculations
  const totalSelectedBytes = useMemo(() => {
    return scannedItems
      .filter(i => selectedItemIds.has(i.id))
      .reduce((acc, curr) => acc + curr.sizeBytes, 0);
  }, [scannedItems, selectedItemIds]);

  const handleItemPress = (item: DiscoveredMediaItem) => {
    if (isSelectionMode) {
      const next = new Set(selectedItemIds);
      if (next.has(item.id)) {
        next.delete(item.id);
        if (next.size === 0) {
          setIsSelectionMode(false);
        }
      } else {
        next.add(item.id);
      }
      setSelectedItemIds(next);
    } else {
      setPreviewItem(item);
      setVideoError(null);
    }
  };

  const handleCloudItemPress = (item: CloudMediaItem) => {
    const isItemLocked = (item.isEncrypted || !!item.encryptionEnvelope) && !isUnlocked;
    if (isItemLocked) {
      setPassphraseInput('');
      setUnlockError(null);
      setUnlockSuccess(null);
      setShowUnlockModal(true);
    } else {
      setPreviewItem(item);
      setVideoError(null);
    }
  };

  const handleItemLongPress = (item: DiscoveredMediaItem) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedItemIds(new Set([item.id]));
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedItemIds.size === filteredDeviceItems.length) {
      setSelectedItemIds(new Set());
      setIsSelectionMode(false);
    } else {
      setSelectedItemIds(new Set(filteredDeviceItems.map(i => i.id)));
    }
  };

  const handleBackupSelected = () => {
    const ids = Array.from(selectedItemIds);
    setIsSelectionMode(false);
    setSelectedItemIds(new Set());
    onConfirmBackup?.(ids);
  };

  const handleExecuteRestore = async () => {
    if (!restoreModalItem) return;
    setRestoring(true);
    setRestoreStatus('Downloading and restoring file...');
    try {
      const success = await onRestoreItem(restoreModalItem, selectedPolicy);
      if (success) {
        setRestoreStatus('✓ Restored successfully to device!');
        setTimeout(() => {
          setRestoring(false);
          setRestoreModalItem(null);
          setRestoreStatus('');
        }, 1200);
      } else {
        setRestoreStatus('Restoration encountered an issue.');
        setRestoring(false);
      }
    } catch (e: any) {
      setRestoreStatus(`Restore failed: ${e?.message || 'Download error'}`);
      setRestoring(false);
    }
  };

  const handleVerifyAndUnlock = async () => {
    const raw = passphraseInput.trim();
    if (!raw) {
      setUnlockError('Please enter your 12-word recovery passphrase.');
      return;
    }

    const words = normalizeRecoveryKey(raw).split(' ');
    if (words.length < 12) {
      setUnlockError('Recovery passphrase must contain all 12 words separated by spaces.');
      return;
    }

    setIsVerifyingKey(true);
    setUnlockError(null);

    try {
      // Attempt verification against the first locked encrypted item or config
      const sampleLockedItem = items.find(
        i => (i.isEncrypted || !!i.encryptionEnvelope) && i.encryptionEnvelope,
      );

      let isValid = false;

      if (sampleLockedItem && sampleLockedItem.encryptionEnvelope) {
        const encObj: EncryptedItemEnvelope =
          typeof sampleLockedItem.encryptionEnvelope === 'string'
            ? JSON.parse(sampleLockedItem.encryptionEnvelope)
            : sampleLockedItem.encryptionEnvelope;

        const verifyResult = verifyPassphraseAgainstItem(raw, encObj);
        if (verifyResult.valid && verifyResult.masterKey) {
          isValid = true;
          SessionKeyStore.setSessionKey(verifyResult.masterKey, raw);
        } else {
          setUnlockError(
            verifyResult.errorMessage ||
              'Incorrect recovery passphrase. Please verify your 12 words.',
          );
          setIsVerifyingKey(false);
          return;
        }
      } else {
        // Fallback: check config if available
        const cfg = SessionKeyStore.getConfig();
        if (cfg) {
          const verifyResult = verifyRecoveryKey(raw, cfg);
          if (verifyResult.valid) {
            isValid = true;
            const masterKey = Buffer.from(verifyResult.masterKeyHex!, 'hex');
            SessionKeyStore.setSessionKey(masterKey, raw, cfg);
          } else {
            setUnlockError(verifyResult.errorMessage || 'Incorrect recovery passphrase.');
            setIsVerifyingKey(false);
            return;
          }
        } else {
          // No encrypted object or config exists yet
          setUnlockError(
            'Cannot verify passphrase: no encrypted cloud media exists yet to authenticate against.',
          );
          setIsVerifyingKey(false);
          return;
        }
      }

      if (isValid) {
        setUnlockSuccess('✓ Passphrase verified! Decrypting cloud media...');
        if (onUnlockPassphrase) {
          await onUnlockPassphrase(raw);
        }
        setTimeout(() => {
          setIsVerifyingKey(false);
          setShowUnlockModal(false);
          setUnlockSuccess(null);
        }, 800);
      }
    } catch (e: any) {
      setUnlockError(`Verification error: ${e?.message || 'Authentication failed'}`);
      setIsVerifyingKey(false);
    }
  };

  const handleLockAgain = () => {
    SessionKeyStore.clear();
  };

  const hasPermissionIssue =
    mediaPermissionStatus === 'denied' || mediaPermissionStatus === 'blocked';

  // Compute thumbnail dimensions for 1-column vs 2-column views
  const itemSize =
    columnCount === 1
      ? SCREEN_WIDTH - 24
      : (SCREEN_WIDTH - 30) / 2;

  // Render Local Media Thumbnail Item (Thumbnails Only, No Cards)
  const renderDeviceGridItem = ({ item }: { item: DiscoveredMediaItem }) => {
    const isBackedUp = backedUpIdSet.has(item.id);
    const isSelected = selectedItemIds.has(item.id);
    const hasImageError = !!imageErrorMap[item.id];

    return (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.thumbnailContainer,
          { width: itemSize, height: itemSize },
          isSelected && styles.thumbnailSelected,
        ]}
        activeOpacity={0.8}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
        accessibilityLabel={item.displayName}
        testID={`device-item-${item.id}`}
      >
        {item.sourceKey && !hasImageError ? (
          <Image
            source={{ uri: item.sourceKey }}
            style={styles.thumbnailImage}
            resizeMode="cover"
            fadeDuration={0}
            onError={() =>
              setImageErrorMap(prev => ({ ...prev, [item.id]: true }))
            }
          />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Text style={styles.thumbnailFallbackIcon}>
              {item.mediaType === 'video' ? '▶' : '🖼'}
            </Text>
          </View>
        )}

        {/* Video Indicator Badge */}
        {item.mediaType === 'video' && (
          <View style={styles.videoBadge}>
            <Text style={styles.videoBadgeText}>▶ Video</Text>
          </View>
        )}

        {/* Backed-up to Telegram Checkmark Badge */}
        {isBackedUp && (
          <View style={styles.backedUpBadge}>
            <Text style={styles.backedUpBadgeText}>✓</Text>
          </View>
        )}

        {/* Selection Checkbox */}
        {isSelectionMode && (
          <View
            style={[
              styles.selectionOverlayCheck,
              isSelected && styles.selectionOverlayCheckActive,
            ]}
          >
            {isSelected && <Text style={styles.selectionCheckmarkText}>✓</Text>}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Render Cloud Media Thumbnail Item (Thumbnails Only, No Cards)
  const renderCloudGridItem = ({ item }: { item: CloudMediaItem }) => {
    const isItemLocked = (item.isEncrypted || !!item.encryptionEnvelope) && !isUnlocked;

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.thumbnailContainer, { width: itemSize, height: itemSize }]}
        activeOpacity={0.8}
        onPress={() => handleCloudItemPress(item)}
        accessibilityLabel={item.originalName}
        testID={`cloud-item-${item.id}`}
      >
        {isItemLocked ? (
          <View style={styles.lockedThumbnailBox}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <Text style={styles.lockedText}>Locked</Text>
          </View>
        ) : (
          <View style={styles.cloudThumbnailBox}>
            <Text style={styles.thumbnailFallbackIcon}>
              {item.mediaType === 'video' ? '▶' : '🖼'}
            </Text>
          </View>
        )}

        {/* Video Indicator Badge */}
        {item.mediaType === 'video' && (
          <View style={styles.videoBadge}>
            <Text style={styles.videoBadgeText}>▶ Video</Text>
          </View>
        )}

        {/* Encrypted indicator */}
        {(item.isEncrypted || !!item.encryptionEnvelope) && (
          <View style={styles.encryptedBadge}>
            <Text style={styles.encryptedBadgeText}>
              {isItemLocked ? '🔒' : '🛡️'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 1. Header with Gallery Title and Layout Toggle */}
      <View style={styles.topHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.headerTitle}>Gallery</Text>
          <View style={styles.topRightControls}>
            {/* Selection Mode Toggle Button */}
            {activeView === 'device' && (
              <TouchableOpacity
                style={[
                  styles.selectModeBtn,
                  isSelectionMode && styles.selectModeBtnActive,
                ]}
                onPress={() => {
                  if (isSelectionMode) {
                    setIsSelectionMode(false);
                    setSelectedItemIds(new Set());
                  } else {
                    setIsSelectionMode(true);
                  }
                }}
                accessibilityLabel="Toggle selection mode"
              >
                <Text
                  style={[
                    styles.selectModeBtnText,
                    isSelectionMode && styles.selectModeBtnTextActive,
                  ]}
                >
                  {isSelectionMode ? 'Done' : 'Select'}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.layoutToggleRow}>
              {/* 1-Column / 2-Column Layout Toggle Button */}
              <TouchableOpacity
                style={[
                  styles.layoutBtn,
                  columnCount === 1 && styles.layoutBtnActive,
                ]}
                onPress={() => setColumnCount(1)}
                accessibilityLabel="One-column layout"
              >
                <Text
                  style={[
                    styles.layoutBtnText,
                    columnCount === 1 && styles.layoutBtnTextActive,
                  ]}
                >
                  1 Col
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.layoutBtn,
                  columnCount === 2 && styles.layoutBtnActive,
                ]}
                onPress={() => setColumnCount(2)}
                accessibilityLabel="Two-column layout"
              >
                <Text
                  style={[
                    styles.layoutBtnText,
                    columnCount === 2 && styles.layoutBtnTextActive,
                  ]}
                >
                  2 Col
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Primary View Switcher Tabs: Local Device vs Cloud Backups */}
        <View style={styles.tabSwitchContainer}>
          <TouchableOpacity
            style={[
              styles.tabSwitchBtn,
              activeView === 'device' && styles.tabSwitchBtnActive,
            ]}
            onPress={() => {
              setActiveView('device');
              setIsSelectionMode(false);
            }}
          >
            <Text
              style={[
                styles.tabSwitchText,
                activeView === 'device' && styles.tabSwitchTextActive,
              ]}
            >
              Device Media ({scannedItems.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabSwitchBtn,
              activeView === 'cloud' && styles.tabSwitchBtnActive,
            ]}
            onPress={() => {
              setActiveView('cloud');
              setIsSelectionMode(false);
            }}
          >
            <Text
              style={[
                styles.tabSwitchText,
                activeView === 'cloud' && styles.tabSwitchTextActive,
              ]}
            >
              Telegram Cloud ({items.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Filter Pills Row */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              filterType === 'all' && styles.filterPillActive,
            ]}
            onPress={() => setFilterType('all')}
          >
            <Text
              style={[
                styles.filterPillText,
                filterType === 'all' && styles.filterPillTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterPill,
              filterType === 'photo' && styles.filterPillActive,
            ]}
            onPress={() => setFilterType('photo')}
          >
            <Text
              style={[
                styles.filterPillText,
                filterType === 'photo' && styles.filterPillTextActive,
              ]}
            >
              Photos
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterPill,
              filterType === 'video' && styles.filterPillActive,
            ]}
            onPress={() => setFilterType('video')}
          >
            <Text
              style={[
                styles.filterPillText,
                filterType === 'video' && styles.filterPillTextActive,
              ]}
            >
              Videos
            </Text>
          </TouchableOpacity>

          {activeView === 'device' && onRescan && (
            <TouchableOpacity style={styles.rescanChip} onPress={onRescan}>
              <Text style={styles.rescanChipText}>↻ Refresh</Text>
            </TouchableOpacity>
          )}

          {activeView === 'cloud' && isUnlocked && (
            <TouchableOpacity style={styles.lockNowChip} onPress={handleLockAgain}>
              <Text style={styles.lockNowChipText}>🔒 Lock</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 2. Permission Banner (Rendered when Permission Needed) */}
      {hasPermissionIssue && (
        <View style={styles.permBanner}>
          <Text style={styles.permTitle}>Photo & Video Permission Needed</Text>
          <Text style={styles.permSubtitle}>
            TG Cloud requires access to your device media to browse and securely back up your photos.
          </Text>
          <TouchableOpacity
            style={styles.permBtn}
            onPress={
              mediaPermissionStatus === 'blocked'
                ? onOpenAppSettings
                : onRequestPermission
            }
          >
            <Text style={styles.permBtnText}>Allow Photo & Video Access</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 3. Cloud Destination & Channel Info Bar (In Cloud View) */}
      {activeView === 'cloud' && (
        <View style={styles.cloudDestinationsContainer}>
          {/* Freshness Status & Resync Action */}
          <View style={styles.freshnessRow}>
            <View
              style={[
                styles.freshnessPill,
                syncFreshnessState === 'synced' && styles.freshnessSynced,
                syncFreshnessState === 'syncing' && styles.freshnessSyncing,
                syncFreshnessState === 'offline' && styles.freshnessOffline,
              ]}
            >
              <Text style={styles.freshnessPillText}>
                {syncFreshnessState === 'syncing'
                  ? '⟳ Syncing with Telegram...'
                  : syncFreshnessState === 'offline'
                  ? '⚡ Offline / Disconnected'
                  : '● Authoritative Telegram Sync'}
              </Text>
            </View>
            {onResyncChannels && (
              <TouchableOpacity
                style={styles.syncNowBtn}
                onPress={onResyncChannels}
                testID="gallery-sync-now-btn"
              >
                <Text style={styles.syncNowBtnText}>↻ Sync now</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Deleted Channel Alert & Recovery Action */}
          {(channels?.photoStatus?.state === 'DELETED' ||
            channels?.videoStatus?.state === 'DELETED') && (
            <View style={styles.deletedChannelCard} testID="deleted-channel-banner">
              <Text style={styles.deletedChannelCardTitle}>
                ⚠ Destination Channel Deleted
              </Text>
              <Text style={styles.deletedChannelCardDesc}>
                A configured backup channel was deleted from Telegram. Recreating creates a fresh private channel for future backups. It does not restore media from the deleted channel.
              </Text>
              <View style={styles.deletedChannelActionsRow}>
                {channels?.photoStatus?.state === 'DELETED' && (
                  <TouchableOpacity
                    style={styles.recreateDestBtn}
                    onPress={() => handlePromptRecreate('photo')}
                    testID="recreate-photo-channel-btn"
                  >
                    <Text style={styles.recreateDestBtnText}>
                      Recreate Photo Channel
                    </Text>
                  </TouchableOpacity>
                )}
                {channels?.videoStatus?.state === 'DELETED' && (
                  <TouchableOpacity
                    style={styles.recreateDestBtn}
                    onPress={() => handlePromptRecreate('video')}
                    testID="recreate-video-channel-btn"
                  >
                    <Text style={styles.recreateDestBtnText}>
                      Recreate Video Channel
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {channels && (
            <View style={styles.destinationBar}>
              <View style={styles.destinationInfo}>
                <Text style={styles.destinationLabel}>BACKUP DESTINATION</Text>
                <Text style={styles.destinationTitle}>
                  {channels.photoChannelTitle || 'Backup - Photos'} & Videos
                </Text>
              </View>
              <TouchableOpacity
                style={styles.openTgBtn}
                onPress={() =>
                  onOpenChannelInTelegram?.(channels.photoChannelId)
                }
              >
                <Text style={styles.openTgBtnText}>Open Telegram ↗</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* 4. Locked Encrypted Media Recovery Banner */}
      {activeView === 'cloud' && lockedItemsCount > 0 && !isUnlocked && (
        <View style={styles.lockedBanner}>
          <View style={styles.lockedBannerRow}>
            <Text style={styles.lockedBannerIcon}>🔒</Text>
            <View style={styles.lockedBannerTextContainer}>
              <Text style={styles.lockedBannerTitle}>
                {lockedItemsCount} Encrypted Backup{lockedItemsCount > 1 ? 's' : ''} Locked
              </Text>
              <Text style={styles.lockedBannerSubtitle}>
                Enter your 12-word recovery passphrase to decrypt and preview.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.enterKeyBtn}
            onPress={() => {
              setPassphraseInput('');
              setUnlockError(null);
              setUnlockSuccess(null);
              setShowUnlockModal(true);
            }}
          >
            <Text style={styles.enterKeyBtnText}>Enter Recovery Passphrase</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 5. Pure Visual Media Grid (Thumbnails Only, No Cards!) */}
      {activeView === 'device' ? (
        filteredDeviceItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🖼️</Text>
            <Text style={styles.emptyTitle}>No Device Photos Found</Text>
            <Text style={styles.emptySubtitle}>
              {hasPermissionIssue
                ? 'Allow photo access above to scan device gallery.'
                : 'Tap Refresh to discover local photos and videos.'}
            </Text>
          </View>
        ) : (
          <FlatList
            key={`device-grid-${columnCount}`}
            data={filteredDeviceItems}
            keyExtractor={item => item.id}
            numColumns={columnCount}
            renderItem={renderDeviceGridItem}
            contentContainerStyle={styles.gridContent}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
            removeClippedSubviews={true}
          />
        )
      ) : filteredCloudItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>☁️</Text>
          <Text style={styles.emptyTitle}>No Cloud Backups Found</Text>
          <Text style={styles.emptySubtitle}>
            Select photos in Device Media and tap Backup Selected to begin backing up to Telegram.
          </Text>
          {onResyncChannels && (
            <TouchableOpacity style={styles.resyncBtn} onPress={onResyncChannels}>
              <Text style={styles.resyncBtnText}>↻ Resync Telegram Channels</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          key={`cloud-grid-${columnCount}`}
          data={filteredCloudItems}
          keyExtractor={item => item.id}
          numColumns={columnCount}
          renderItem={renderCloudGridItem}
          contentContainerStyle={styles.gridContent}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}

      {/* 6. Multi-Selection Sticky Bottom Bar */}
      {isSelectionMode && (
        <View style={styles.selectionBar}>
          <View style={styles.selectionBarInfo}>
            <Text style={styles.selectionCountText}>
              {selectedItemIds.size} Selected
            </Text>
            <Text style={styles.selectionBytesText}>
              {formatBytes(totalSelectedBytes)}
            </Text>
          </View>

          <View style={styles.selectionBarActions}>
            <TouchableOpacity
              style={styles.selectToggleBtn}
              onPress={handleToggleSelectAll}
              testID="select-all-toggle-btn"
            >
              <Text style={styles.selectToggleBtnText}>
                {selectedItemIds.size === filteredDeviceItems.length
                  ? 'Deselect All'
                  : 'Select All'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelSelectBtn}
              onPress={() => {
                setIsSelectionMode(false);
                setSelectedItemIds(new Set());
              }}
              testID="cancel-select-btn"
            >
              <Text style={styles.cancelSelectBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.backupSelectedBtn,
                selectedItemIds.size === 0 && styles.btnDisabled,
              ]}
              disabled={selectedItemIds.size === 0}
              onPress={handleBackupSelected}
              testID="backup-selected-btn"
            >
              <Text style={styles.backupSelectedBtnText}>
                Backup ({selectedItemIds.size})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 7. Full-Screen Photo / Video Viewer Modal */}
      {previewItem && (
        <Modal
          visible={true}
          transparent={false}
          animationType="fade"
          onRequestClose={handleCloseViewer}
        >
          <View style={styles.viewerContainer}>
            {/* Viewer Top Bar with Safe Area Padding */}
            <View
              style={[
                styles.viewerTopBar,
                {
                  paddingTop: Math.max(insets.top, 16),
                  paddingLeft: Math.max(insets.left, 16),
                  paddingRight: Math.max(insets.right, 16),
                },
              ]}
            >
              <TouchableOpacity
                style={styles.viewerCloseBtn}
                onPress={handleCloseViewer}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Close media viewer"
              >
                <Text style={styles.viewerCloseBtnText}>✕ Close</Text>
              </TouchableOpacity>
              <Text style={styles.viewerTitle} numberOfLines={1}>
                {'displayName' in previewItem
                  ? previewItem.displayName
                  : previewItem.originalName}
              </Text>
              <View style={styles.viewerSpacer} />
            </View>

            {/* Viewer Content Area */}
            <View style={styles.viewerImageArea}>
              {previewItem.mediaType === 'video' ? (
                playableVideoUri ? (
                  <InAppVideoPlayer
                    sourceUri={playableVideoUri}
                    isEncrypted={!!('isEncrypted' in previewItem && previewItem.isEncrypted)}
                    onClose={handleCloseViewer}
                    onError={err => setVideoError(err)}
                    testID="in-app-video-player"
                  />
                ) : (
                  <View style={styles.videoPreparingContainer}>
                    <ActivityIndicator size="large" color="#34d399" />
                    <Text style={styles.videoPreparingText}>
                      {videoLoadingMsg || 'Preparing in-app video...'}
                    </Text>
                    {videoError && (
                      <View style={styles.videoPlayerErrorBox}>
                        <Text style={styles.videoPlayerErrorText}>
                          ⚠ {videoError}
                        </Text>
                        <TouchableOpacity
                          style={styles.retryPrepBtn}
                          onPress={handleRetryVideoPreparation}
                        >
                          <Text style={styles.retryPrepBtnText}>
                            ↻ Retry Preparation
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )
              ) : (
                'sourceKey' in previewItem && previewItem.sourceKey ? (
                  <Image
                    source={{ uri: previewItem.sourceKey }}
                    style={styles.fullImage}
                    resizeMode="contain"
                    accessibilityLabel="Full screen image preview"
                    testID="full-viewer-image"
                  />
                ) : (
                  <View style={styles.viewerPlaceholder}>
                    <Text style={styles.viewerPlaceholderIcon}>🖼</Text>
                    <Text style={styles.viewerPlaceholderText}>
                      {'displayName' in previewItem
                        ? previewItem.displayName
                        : previewItem.originalName}
                    </Text>
                  </View>
                )
              )}
            </View>

            {/* Viewer Details & Bottom Actions with Safe Area Insets */}
            <View
              style={[
                styles.viewerBottomBar,
                {
                  paddingBottom: Math.max(insets.bottom, 16),
                  paddingLeft: Math.max(insets.left, 16),
                  paddingRight: Math.max(insets.right, 16),
                },
              ]}
            >
              <View style={styles.viewerMetaRow}>
                <Text style={styles.viewerMetaText}>
                  {formatBytes(previewItem.sizeBytes)} ·{' '}
                  {formatDate(previewItem.modifiedAtMs)}
                </Text>
                <Text style={styles.viewerStatusHighlight}>
                  {backedUpIdSet.has(previewItem.id)
                    ? '✓ Backed Up'
                    : 'Local Device Media'}
                </Text>
              </View>

              <View style={styles.viewerActionsRow}>
                {!backedUpIdSet.has(previewItem.id) && onConfirmBackup && (
                  <TouchableOpacity
                    style={styles.viewerPrimaryBtn}
                    onPress={() => {
                      const id = previewItem.id;
                      handleCloseViewer();
                      onConfirmBackup([id]);
                    }}
                  >
                    <Text style={styles.viewerPrimaryBtnText}>
                      Backup to Telegram
                    </Text>
                  </TouchableOpacity>
                )}

                {'messageId' in previewItem && (
                  <TouchableOpacity
                    style={styles.viewerRestoreBtn}
                    onPress={() => {
                      setRestoreModalItem(previewItem as CloudMediaItem);
                      handleCloseViewer();
                    }}
                  >
                    <Text style={styles.viewerRestoreBtnText}>
                      Restore to Photos
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 8. Unlock Passphrase Modal */}
      <Modal
        visible={showUnlockModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowUnlockModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.unlockModalCard}>
            <View style={styles.unlockModalHeader}>
              <Text style={styles.unlockModalIcon}>🔒</Text>
              <Text style={styles.unlockModalTitle}>Unlock Encrypted Media</Text>
            </View>

            <Text style={styles.unlockModalDesc}>
              Enter the 12-word recovery passphrase generated when client-side encryption was configured. Your key never leaves this device.
            </Text>

            <TextInput
              style={styles.passphraseTextInput}
              placeholder="e.g. eagle harbor quartz river beacon..."
              placeholderTextColor="#6b7280"
              value={passphraseInput}
              onChangeText={setPassphraseInput}
              multiline={true}
              numberOfLines={3}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {unlockError && (
              <Text style={styles.modalErrorText}>⚠ {unlockError}</Text>
            )}

            {unlockSuccess && (
              <Text style={styles.modalSuccessText}>{unlockSuccess}</Text>
            )}

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowUnlockModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  isVerifyingKey && styles.btnDisabled,
                ]}
                disabled={isVerifyingKey}
                onPress={handleVerifyAndUnlock}
              >
                {isVerifyingKey ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Unlock Backups</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 9. Restore Modal */}
      {restoreModalItem && (
        <Modal
          visible={true}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setRestoreModalItem(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.unlockModalCard}>
              <Text style={styles.unlockModalTitle}>Restore to Device</Text>
              <Text style={styles.unlockModalDesc}>
                Download and restore &quot;{restoreModalItem.originalName}&quot; to your device storage.
              </Text>

              <View style={styles.policyRow}>
                <TouchableOpacity
                  style={[
                    styles.policyChip,
                    selectedPolicy === ConflictPolicy.KEEP_BOTH &&
                      styles.policyChipActive,
                  ]}
                  onPress={() => setSelectedPolicy(ConflictPolicy.KEEP_BOTH)}
                >
                  <Text style={styles.policyChipText}>Keep Both</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.policyChip,
                    selectedPolicy === ConflictPolicy.REPLACE &&
                      styles.policyChipActive,
                  ]}
                  onPress={() => setSelectedPolicy(ConflictPolicy.REPLACE)}
                >
                  <Text style={styles.policyChipText}>Replace Existing</Text>
                </TouchableOpacity>
              </View>

              {restoreStatus ? (
                <Text style={styles.modalSuccessText}>{restoreStatus}</Text>
              ) : null}

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  disabled={restoring}
                  onPress={() => setRestoreModalItem(null)}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalConfirmBtn,
                    restoring && styles.btnDisabled,
                  ]}
                  disabled={restoring}
                  onPress={handleExecuteRestore}
                >
                  {restoring ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.modalConfirmBtnText}>Restore Now</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 10. Recreate Deleted Destination Confirmation Modal */}
      <Modal
        visible={showRecreateModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isRecreating) {
            setShowRecreateModal(false);
            setRecreateTarget(null);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.recreateModalCard}>
            <Text style={styles.recreateModalTitle}>
              Recreate {recreateTarget === 'photo' ? 'Photo' : 'Video'} Channel
            </Text>
            <Text style={styles.recreateModalWarning}>
              ⚠ Important Recovery Notice:
            </Text>
            <Text style={styles.recreateModalDesc}>
              The previous backup channel was permanently deleted from Telegram.
              {'\n\n'}
              Recreating creates a brand new, private destination for future backups. It does NOT restore photos or videos from the deleted channel.
            </Text>

            {recreateError && (
              <Text style={styles.modalErrorText}>⚠ {recreateError}</Text>
            )}

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                disabled={isRecreating}
                onPress={() => {
                  setShowRecreateModal(false);
                  setRecreateTarget(null);
                }}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.recreateConfirmBtn,
                  isRecreating && styles.btnDisabled,
                ]}
                disabled={isRecreating}
                onPress={handleConfirmRecreate}
                testID="confirm-recreate-channel-btn"
              >
                {isRecreating ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.recreateConfirmBtnText}>
                    Confirm & Recreate
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
  },
  topHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#16221c',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  layoutToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#111814',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#243029',
  },
  layoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  layoutBtnActive: {
    backgroundColor: '#10b981',
  },
  layoutBtnText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
  },
  layoutBtnTextActive: {
    color: '#ffffff',
  },
  tabSwitchContainer: {
    flexDirection: 'row',
    backgroundColor: '#111814',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e2923',
  },
  tabSwitchBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabSwitchBtnActive: {
    backgroundColor: '#16221c',
    borderWidth: 1,
    borderColor: '#2d3d34',
  },
  tabSwitchText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  tabSwitchTextActive: {
    color: '#34d399',
    fontWeight: '700',
  },
  filterPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#111814',
    borderWidth: 1,
    borderColor: '#243029',
  },
  filterPillActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  filterPillText: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  rescanChip: {
    marginLeft: 'auto',
    backgroundColor: '#16221c',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243029',
  },
  rescanChipText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  lockNowChip: {
    marginLeft: 'auto',
    backgroundColor: '#261c1c',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#543333',
  },
  lockNowChipText: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '700',
  },
  permBanner: {
    backgroundColor: '#261c1c',
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 8,
  },
  permTitle: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  permSubtitle: {
    color: '#f87171',
    fontSize: 12,
    marginBottom: 8,
  },
  permBtn: {
    backgroundColor: '#ef4444',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  permBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  destinationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111814',
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2923',
  },
  destinationInfo: {
    flex: 1,
  },
  destinationLabel: {
    fontSize: 9,
    color: '#6b7280',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  destinationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e5e7eb',
    marginTop: 2,
  },
  openTgBtn: {
    backgroundColor: '#16221c',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2d3d34',
  },
  openTgBtnText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  lockedBanner: {
    backgroundColor: '#1b1b13',
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4d4625',
  },
  lockedBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  lockedBannerIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  lockedBannerTextContainer: {
    flex: 1,
  },
  lockedBannerTitle: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '700',
  },
  lockedBannerSubtitle: {
    color: '#d1d5db',
    fontSize: 11,
    marginTop: 2,
  },
  enterKeyBtn: {
    backgroundColor: '#d97706',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  enterKeyBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  gridContent: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 90,
    gap: 6,
  },
  thumbnailContainer: {
    margin: 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#111814',
    borderWidth: 1,
    borderColor: '#1e2923',
    position: 'relative',
  },
  thumbnailSelected: {
    borderColor: '#10b981',
    borderWidth: 2,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16221c',
  },
  thumbnailFallbackIcon: {
    fontSize: 28,
  },
  cloudThumbnailBox: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16221c',
  },
  lockedThumbnailBox: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161414',
  },
  lockedIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  lockedText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  videoBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  backedUpBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: '#10b981',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backedUpBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  encryptedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 3,
    borderRadius: 4,
  },
  encryptedBadgeText: {
    fontSize: 11,
  },
  selectionOverlayCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionOverlayCheckActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  selectionCheckmarkText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 44,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
  },
  resyncBtn: {
    marginTop: 16,
    backgroundColor: '#16221c',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#243029',
  },
  resyncBtnText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '700',
  },
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0e1411',
    borderTopWidth: 1,
    borderTopColor: '#243029',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectionBarInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  selectionCountText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  selectionBytesText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  selectionBarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  selectToggleBtn: {
    backgroundColor: '#16221c',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#243029',
  },
  selectToggleBtnText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  cancelSelectBtn: {
    backgroundColor: '#1f2937',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  cancelSelectBtnText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
  backupSelectedBtn: {
    flex: 1,
    backgroundColor: '#10b981',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupSelectedBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  viewerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  viewerSpacer: {
    width: 40,
  },
  viewerCloseBtn: {
    padding: 6,
  },
  viewerCloseBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  viewerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 10,
  },
  viewerImageArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  viewerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerPlaceholderIcon: {
    fontSize: 64,
    marginBottom: 12,
  },
  viewerPlaceholderText: {
    color: '#9ca3af',
    fontSize: 14,
    maxWidth: '80%',
    textAlign: 'center',
  },
  videoControlsOverlay: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  videoPlayOverlayBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.95)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  videoPlayingBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
  },
  videoLoadingBtn: {
    backgroundColor: 'rgba(55, 65, 81, 0.85)',
  },
  videoPlayOverlayText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  videoPlayerStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(18, 26, 21, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#34d399',
  },
  videoPlayerStatusText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '600',
  },
  videoPlayerErrorBox: {
    backgroundColor: 'rgba(127, 29, 29, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  videoPlayerErrorText: {
    color: '#fecaca',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  viewerBottomBar: {
    backgroundColor: '#0e1411',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1e2923',
  },
  viewerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewerMetaText: {
    color: '#9ca3af',
    fontSize: 13,
  },
  viewerStatusHighlight: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
  },
  viewerActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  viewerPrimaryBtn: {
    flex: 1,
    backgroundColor: '#10b981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewerPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  viewerRestoreBtn: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewerRestoreBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  unlockModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#16221c',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#243029',
  },
  unlockModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  unlockModalIcon: {
    fontSize: 22,
    marginRight: 8,
  },
  unlockModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  unlockModalDesc: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    marginBottom: 14,
  },
  passphraseTextInput: {
    backgroundColor: '#0a0f0d',
    borderWidth: 1,
    borderColor: '#243029',
    borderRadius: 8,
    color: '#ffffff',
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  modalErrorText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  modalSuccessText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalCancelBtnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  modalConfirmBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  policyRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  policyChip: {
    flex: 1,
    backgroundColor: '#111814',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#243029',
  },
  policyChipActive: {
    backgroundColor: '#16221c',
    borderColor: '#10b981',
  },
  policyChipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  topRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectModeBtn: {
    backgroundColor: '#111814',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#243029',
  },
  selectModeBtnActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  selectModeBtnText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
  },
  selectModeBtnTextActive: {
    color: '#ffffff',
  },
  cloudDestinationsContainer: {
    marginHorizontal: 16,
    marginTop: 8,
  },
  freshnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  freshnessPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#111814',
    borderWidth: 1,
    borderColor: '#1e2923',
  },
  freshnessSynced: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  freshnessSyncing: {
    borderColor: 'rgba(59, 130, 246, 0.4)',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  freshnessOffline: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  freshnessPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  syncNowBtn: {
    backgroundColor: '#16221c',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#243029',
  },
  syncNowBtnText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  deletedChannelCard: {
    backgroundColor: '#2b1414',
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  deletedChannelCardTitle: {
    color: '#f87171',
    fontWeight: '800',
    fontSize: 13,
    marginBottom: 4,
  },
  deletedChannelCardDesc: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  deletedChannelActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  recreateDestBtn: {
    backgroundColor: '#ef4444',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  recreateDestBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  videoPreparingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  videoPreparingText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
  },
  retryPrepBtn: {
    backgroundColor: '#374151',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginTop: 10,
    alignSelf: 'center',
  },
  retryPrepBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  recreateModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111814',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    padding: 20,
  },
  recreateModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
  },
  recreateModalWarning: {
    fontSize: 12,
    fontWeight: '800',
    color: '#f87171',
    marginBottom: 4,
  },
  recreateModalDesc: {
    fontSize: 12,
    color: '#d1d5db',
    lineHeight: 18,
    marginBottom: 16,
  },
  recreateConfirmBtn: {
    flex: 1,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recreateConfirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
