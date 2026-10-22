import React, { useState, useMemo } from 'react';
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
import { ConflictPolicy } from '../domain/backup/stateMachine';
import { BackupTransferProgress } from '../domain/backup/engine';
import { MediaPermissionStatus } from '../domain/permissions/permissionService';
import { TelegramBackupChannels } from '../types/telegram';
import {
  SessionKeyStore,
  verifyPassphraseAgainstItem,
  verifyRecoveryKey,
  normalizeRecoveryKey,
} from '../domain/crypto/encryptionService';
import { EncryptedItemEnvelope } from '../types/encryption';

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

  // In-App Full-Screen Viewer State
  const [previewItem, setPreviewItem] = useState<
    DiscoveredMediaItem | CloudMediaItem | null
  >(null);
  const [isPlayingVideo, setIsPlayingVideo] = useState<boolean>(false);

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
      setIsPlayingVideo(false);
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
      setIsPlayingVideo(false);
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
      {activeView === 'cloud' && channels && (
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
          onRequestClose={() => setPreviewItem(null)}
        >
          <View style={styles.viewerContainer}>
            {/* Viewer Top Bar */}
            <View style={styles.viewerTopBar}>
              <TouchableOpacity
                style={styles.viewerCloseBtn}
                onPress={() => setPreviewItem(null)}
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
              {'sourceKey' in previewItem && previewItem.sourceKey ? (
                <Image
                  source={{ uri: previewItem.sourceKey }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.viewerPlaceholder}>
                  <Text style={styles.viewerPlaceholderIcon}>
                    {previewItem.mediaType === 'video' ? '▶' : '🖼'}
                  </Text>
                  <Text style={styles.viewerPlaceholderText}>
                    {'displayName' in previewItem
                      ? previewItem.displayName
                      : previewItem.originalName}
                  </Text>
                </View>
              )}

              {/* Video Playback overlay */}
              {previewItem.mediaType === 'video' && (
                <TouchableOpacity
                  style={styles.videoPlayOverlayBtn}
                  onPress={() => setIsPlayingVideo(!isPlayingVideo)}
                >
                  <Text style={styles.videoPlayOverlayText}>
                    {isPlayingVideo ? '⏸ Pause' : '▶ Play Video'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Viewer Details & Bottom Actions */}
            <View style={styles.viewerBottomBar}>
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
                      setPreviewItem(null);
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
                      setPreviewItem(null);
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
  videoPlayOverlayBtn: {
    position: 'absolute',
    bottom: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  videoPlayOverlayText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
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
});
