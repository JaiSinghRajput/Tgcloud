import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Switch,
} from 'react-native';
import { ConflictPolicy } from '../domain/backup/stateMachine';
import { BackupTransferProgress } from '../domain/backup/engine';
import { MediaPermissionStatus } from '../domain/permissions/permissionService';

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
  onRequestPermission?: () => void;
  onOpenAppSettings?: () => void;
  onRescan?: () => void;
  onToggleFolderExclusion?: (folderKey: string) => void;
  onConfirmBackup?: () => void;
  onTogglePause?: () => void;
  onRestoreItem: (
    item: CloudMediaItem,
    policy: ConflictPolicy,
  ) => Promise<boolean>;
}

export const CloudGalleryScreen: React.FC<CloudGalleryScreenProps> = ({
  items,
  scannedItems = [],
  folders = [],
  eligibleCount = 0,
  eligibleBytes = 0,
  isPaused = false,
  activeProgress = null,
  mediaPermissionStatus = 'granted',
  onRequestPermission,
  onOpenAppSettings,
  onRescan,
  onToggleFolderExclusion,
  onConfirmBackup,
  onTogglePause,
  onRestoreItem,
}) => {
  const [activeView, setActiveView] = useState<'cloud' | 'device'>(
    items.length > 0 ? 'cloud' : 'device',
  );
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string>('all');

  // Initial Backup confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showFoldersInModal, setShowFoldersInModal] = useState<boolean>(false);

  // Restore Modal State
  const [restoreModalItem, setRestoreModalItem] = useState<CloudMediaItem | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<ConflictPolicy>(
    ConflictPolicy.KEEP_BOTH,
  );
  const [restoring, setRestoring] = useState<boolean>(false);
  const [restoreStatus, setRestoreStatus] = useState<string>('');

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (ms: number): string => {
    return new Date(ms).toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Cloud folders derivation
  const cloudFolders = Array.from(
    new Set(
      items.map(i => {
        const parts = i.relativePath.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root';
      }),
    ),
  );

  // Device folders derivation
  const deviceFolders = folders.map(f => f.folderKey);

  const currentFolderList = activeView === 'cloud' ? cloudFolders : deviceFolders;

  // Filtered cloud items
  const filteredCloudItems = items.filter(item => {
    if (filterType !== 'all' && item.mediaType !== filterType) return false;
    if (selectedFolder !== 'all') {
      const itemFolder = item.relativePath.includes('/')
        ? item.relativePath.substring(0, item.relativePath.lastIndexOf('/'))
        : 'Root';
      if (itemFolder !== selectedFolder) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.originalName.toLowerCase().includes(q) ||
        item.relativePath.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filtered device items
  const filteredDeviceItems = scannedItems.filter(item => {
    if (filterType !== 'all' && item.mediaType !== filterType) return false;
    if (selectedFolder !== 'all') {
      const itemFolder = item.relativePath.includes('/')
        ? item.relativePath.substring(0, item.relativePath.lastIndexOf('/'))
        : 'Root';
      if (!itemFolder.toLowerCase().includes(selectedFolder.toLowerCase())) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.displayName.toLowerCase().includes(q) ||
        item.relativePath.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleExecuteRestore = async () => {
    if (!restoreModalItem) return;
    setRestoring(true);
    setRestoreStatus('Downloading and restoring file...');
    try {
      const success = await onRestoreItem(restoreModalItem, selectedPolicy);
      if (success) {
        setRestoreStatus(
          `Restored '${restoreModalItem.originalName}' successfully!`,
        );
        setTimeout(() => {
          setRestoreModalItem(null);
          setRestoreStatus('');
        }, 1500);
      } else {
        setRestoreStatus('Restore failed or source missing.');
      }
    } catch (e: any) {
      setRestoreStatus(`Restore error: ${e.message}`);
    } finally {
      setRestoring(false);
    }
  };

  const hasPermissionIssue =
    mediaPermissionStatus === 'denied' || mediaPermissionStatus === 'blocked';
  const hasPartialPermission = mediaPermissionStatus === 'partial';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Screen Header */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View>
              <Text style={styles.headerEyebrow}>SECURE STORAGE</Text>
              <Text style={styles.headerTitle}>Gallery</Text>
            </View>
            {onRescan && (
              <TouchableOpacity
                style={styles.rescanButton}
                onPress={onRescan}
                accessibilityLabel="Rescan device media"
              >
                <Text style={styles.rescanButtonText}>↻ Rescan</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.headerDesc}>
            Private photo and video backup encrypted directly into your Telegram cloud channels.
          </Text>
        </View>

        {/* 1. Android Permission Alert Banner */}
        {hasPermissionIssue && (
          <View style={styles.permissionAlertCard}>
            <View style={styles.permissionAlertHeader}>
              <Text style={styles.permissionAlertTitle}>
                Photo & Video Permission Needed
              </Text>
            </View>
            <Text style={styles.permissionAlertDesc}>
              Telegram Gallery Backup needs permission to access your device storage so it can discover and back up your photos and videos.
            </Text>
            <TouchableOpacity
              style={styles.permissionActionButton}
              onPress={
                mediaPermissionStatus === 'blocked' && onOpenAppSettings
                  ? onOpenAppSettings
                  : onRequestPermission
              }
            >
              <Text style={styles.permissionActionButtonText}>
                {mediaPermissionStatus === 'blocked'
                  ? 'Open Android App Settings'
                  : 'Allow Photo & Video Access'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {hasPartialPermission && (
          <View style={styles.partialAlertCard}>
            <View style={styles.partialAlertTextCol}>
              <Text style={styles.partialAlertTitle}>Selected Photos Only</Text>
              <Text style={styles.partialAlertDesc}>
                Access is limited to photos you selected in Android 14+. Grant full access to back up all media.
              </Text>
            </View>
            {onRequestPermission && (
              <TouchableOpacity
                style={styles.partialActionBtn}
                onPress={onRequestPermission}
              >
                <Text style={styles.partialActionText}>Manage</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 2. Concise Backup Status Bar */}
        <View style={styles.statusBarCard}>
          {activeProgress ? (
            <View style={styles.progressSection}>
              <View style={styles.statusRow}>
                <View style={styles.statusBadgeRow}>
                  <View style={styles.statusDotActive} />
                  <Text style={styles.statusLabelActive}>UPLOADING</Text>
                </View>
                <Text style={styles.statusPercent}>
                  {activeProgress.totalBytes > 0
                    ? `${Math.round(
                        (activeProgress.bytesUploaded /
                          activeProgress.totalBytes) *
                          100,
                      )}%`
                    : 'Starting...'}
                </Text>
              </View>

              <Text style={styles.statusFileName} numberOfLines={1}>
                {activeProgress.displayName}
              </Text>

              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${
                        activeProgress.totalBytes > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (activeProgress.bytesUploaded /
                                  activeProgress.totalBytes) *
                                  100,
                              ),
                            )
                          : 10
                      }%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.statusBottomRow}>
                <Text style={styles.statusMeta}>
                  {formatBytes(activeProgress.bytesUploaded)} /{' '}
                  {formatBytes(activeProgress.totalBytes)}
                </Text>
                {onTogglePause && (
                  <TouchableOpacity
                    style={styles.pauseSmallButton}
                    onPress={onTogglePause}
                  >
                    <Text style={styles.pauseSmallButtonText}>Pause</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : isPaused ? (
            <View style={styles.pausedSection}>
              <View style={styles.statusRow}>
                <View style={styles.statusBadgeRow}>
                  <View style={styles.statusDotPaused} />
                  <Text style={styles.statusLabelPaused}>BACKUP PAUSED</Text>
                </View>
                {onTogglePause && (
                  <TouchableOpacity
                    style={styles.resumeSmallButton}
                    onPress={onTogglePause}
                  >
                    <Text style={styles.resumeSmallButtonText}>Resume Sync</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.statusPausedDesc}>
                Sync is paused. Tap Resume to continue uploading queued photos.
              </Text>
            </View>
          ) : eligibleCount > 0 ? (
            <View style={styles.readySection}>
              <View style={styles.statusRow}>
                <View style={styles.statusInfoCol}>
                  <Text style={styles.readyTitle}>
                    {eligibleCount} {eligibleCount === 1 ? 'item' : 'items'} ready to back up
                  </Text>
                  <Text style={styles.readySub}>
                    Total size: {formatBytes(eligibleBytes)}
                  </Text>
                </View>
                {onConfirmBackup && (
                  <TouchableOpacity
                    style={styles.backupActionButton}
                    onPress={() => setShowConfirmModal(true)}
                  >
                    <Text style={styles.backupActionButtonText}>Start Backup</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : items.length > 0 ? (
            <View style={styles.syncedSection}>
              <Text style={styles.syncedText}>
                ✓ All discovered media backed up ({items.length} in Telegram Cloud)
              </Text>
            </View>
          ) : (
            <View style={styles.syncedSection}>
              <Text style={styles.syncedText}>
                No pending items. Your gallery is up to date.
              </Text>
            </View>
          )}
        </View>

        {/* 3. View Switcher Pills */}
        <View style={styles.viewTabs}>
          <TouchableOpacity
            style={[
              styles.viewTab,
              activeView === 'cloud' && styles.viewTabActive,
            ]}
            onPress={() => {
              setActiveView('cloud');
              setSelectedFolder('all');
            }}
          >
            <Text
              style={[
                styles.viewTabText,
                activeView === 'cloud' && styles.viewTabTextActive,
              ]}
            >
              Cloud Backups ({items.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewTab,
              activeView === 'device' && styles.viewTabActive,
            ]}
            onPress={() => {
              setActiveView('device');
              setSelectedFolder('all');
            }}
          >
            <Text
              style={[
                styles.viewTabText,
                activeView === 'device' && styles.viewTabTextActive,
              ]}
            >
              Device Media ({scannedItems.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* 4. Search and Filter Controls */}
        <TextInput
          style={styles.searchInput}
          placeholder={
            activeView === 'cloud'
              ? 'Search backed-up files...'
              : 'Search device photos & videos...'
          }
          placeholderTextColor="#6b7280"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        {/* Filter Pills (All / Photos / Videos) */}
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
        </View>

        {/* Folder Chips */}
        {currentFolderList.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.folderScroll}
          >
            <TouchableOpacity
              style={[
                styles.folderChip,
                selectedFolder === 'all' && styles.folderChipActive,
              ]}
              onPress={() => setSelectedFolder('all')}
            >
              <Text
                style={[
                  styles.folderChipText,
                  selectedFolder === 'all' && styles.folderChipTextActive,
                ]}
              >
                All Folders
              </Text>
            </TouchableOpacity>
            {currentFolderList.map(folder => (
              <TouchableOpacity
                key={folder}
                style={[
                  styles.folderChip,
                  selectedFolder === folder && styles.folderChipActive,
                ]}
                onPress={() => setSelectedFolder(folder)}
              >
                <Text
                  style={[
                    styles.folderChipText,
                    selectedFolder === folder && styles.folderChipTextActive,
                  ]}
                >
                  {folder}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* 5. Items Display List */}
        {activeView === 'cloud' ? (
          <View style={styles.itemsList}>
            {filteredCloudItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {items.length === 0
                    ? 'No photos backed up yet'
                    : 'No matches found'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {items.length === 0
                    ? 'Scan your device media and tap Start Backup to begin syncing photos to Telegram.'
                    : 'Try adjusting your search query or folder filter.'}
                </Text>
              </View>
            ) : (
              filteredCloudItems.map(item => (
                <View key={item.id} style={styles.mediaItemCard}>
                  <View style={styles.mediaItemIcon}>
                    <Text style={styles.mediaItemIconText}>
                      {item.mediaType === 'video' ? '▶' : '🖼'}
                    </Text>
                  </View>

                  <View style={styles.mediaItemDetails}>
                    <Text style={styles.mediaItemName} numberOfLines={1}>
                      {item.originalName}
                    </Text>
                    <Text style={styles.mediaItemPath} numberOfLines={1}>
                      {item.relativePath}
                    </Text>
                    <Text style={styles.mediaItemMeta}>
                      {formatBytes(item.sizeBytes)} · {formatDate(item.modifiedAtMs)}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.restoreItemButton}
                    onPress={() => setRestoreModalItem(item)}
                  >
                    <Text style={styles.restoreItemButtonText}>Restore</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={styles.itemsList}>
            {filteredDeviceItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {scannedItems.length === 0
                    ? 'No device media discovered'
                    : 'No matches found'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {hasPermissionIssue
                    ? 'Grant photo & video access above to allow scanning.'
                    : 'Tap Rescan to refresh media from your device storage.'}
                </Text>
                {onRescan && !hasPermissionIssue && (
                  <TouchableOpacity
                    style={styles.scanNowButton}
                    onPress={onRescan}
                  >
                    <Text style={styles.scanNowButtonText}>Scan Device Media</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              filteredDeviceItems.map(item => {
                const isBackedUp = items.some(ci => ci.id === item.id);
                return (
                  <View key={item.id} style={styles.mediaItemCard}>
                    <View style={styles.mediaItemIcon}>
                      <Text style={styles.mediaItemIconText}>
                        {item.mediaType === 'video' ? '▶' : '🖼'}
                      </Text>
                    </View>

                    <View style={styles.mediaItemDetails}>
                      <Text style={styles.mediaItemName} numberOfLines={1}>
                        {item.displayName}
                      </Text>
                      <Text style={styles.mediaItemPath} numberOfLines={1}>
                        {item.relativePath}
                      </Text>
                      <Text style={styles.mediaItemMeta}>
                        {formatBytes(item.sizeBytes)} · {formatDate(item.modifiedAtMs)}
                      </Text>
                    </View>

                    <View style={styles.deviceStatusCol}>
                      {isBackedUp ? (
                        <View style={styles.badgeBackedUp}>
                          <Text style={styles.badgeBackedUpText}>✓ Backed Up</Text>
                        </View>
                      ) : item.isExcluded ? (
                        <View style={styles.badgeExcluded}>
                          <Text style={styles.badgeExcludedText}>Excluded</Text>
                        </View>
                      ) : (
                        <View style={styles.badgePending}>
                          <Text style={styles.badgePendingText}>Ready</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      {/* 6. Initial Backup Confirmation Modal */}
      {showConfirmModal && (
        <Modal transparent animationType="fade" visible={showConfirmModal}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Confirm Telegram Cloud Backup</Text>
              <Text style={styles.modalSub}>
                Ready to back up {eligibleCount} photos and videos ({formatBytes(eligibleBytes)}) to your private Telegram storage.
              </Text>

              {folders.length > 0 && (
                <View style={styles.modalFolderSection}>
                  <TouchableOpacity
                    style={styles.folderToggleHeader}
                    onPress={() => setShowFoldersInModal(!showFoldersInModal)}
                  >
                    <Text style={styles.folderToggleHeaderText}>
                      {showFoldersInModal ? '▼ Hide Folders' : '▶ Review Folders'} ({folders.length})
                    </Text>
                  </TouchableOpacity>

                  {showFoldersInModal && (
                    <ScrollView style={styles.modalFolderScroll}>
                      {folders.map(folder => (
                        <View key={folder.folderKey} style={styles.folderRow}>
                          <View style={styles.folderInfoCol}>
                            <Text style={styles.folderRowTitle}>
                              {folder.displayLabel}
                            </Text>
                            <Text style={styles.folderRowMeta}>
                              {folder.itemCount} items · {formatBytes(folder.byteSize)}
                            </Text>
                          </View>
                          {onToggleFolderExclusion && (
                            <Switch
                              value={!folder.isExcluded}
                              onValueChange={() =>
                                onToggleFolderExclusion(folder.folderKey)
                              }
                              trackColor={{ false: '#374151', true: '#047857' }}
                              thumbColor={!folder.isExcluded ? '#10b981' : '#9ca3af'}
                            />
                          )}
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setShowConfirmModal(false)}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalConfirmButton}
                  onPress={() => {
                    setShowConfirmModal(false);
                    onConfirmBackup?.();
                  }}
                >
                  <Text style={styles.modalConfirmButtonText}>Start Backup</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 7. Restore Modal Sheet with Conflict Policy */}
      {restoreModalItem && (
        <Modal transparent animationType="slide" visible={!!restoreModalItem}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Restore Media Item</Text>
              <Text style={styles.modalSub}>{restoreModalItem.originalName}</Text>
              <Text style={styles.modalPath}>Target: {restoreModalItem.relativePath}</Text>

              <Text style={styles.policyHeading}>COLLISION CONFLICT POLICY</Text>
              <View style={styles.policyChoices}>
                <TouchableOpacity
                  style={[
                    styles.policyChoice,
                    selectedPolicy === ConflictPolicy.KEEP_BOTH &&
                      styles.policyChoiceSelected,
                  ]}
                  onPress={() => setSelectedPolicy(ConflictPolicy.KEEP_BOTH)}
                >
                  <Text style={styles.policyChoiceTitle}>Keep Both</Text>
                  <Text style={styles.policyChoiceDesc}>
                    Appends (1) if file already exists locally
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.policyChoice,
                    selectedPolicy === ConflictPolicy.SKIP &&
                      styles.policyChoiceSelected,
                  ]}
                  onPress={() => setSelectedPolicy(ConflictPolicy.SKIP)}
                >
                  <Text style={styles.policyChoiceTitle}>Skip Existing</Text>
                  <Text style={styles.policyChoiceDesc}>
                    Do not overwrite existing local file
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.policyChoice,
                    selectedPolicy === ConflictPolicy.REPLACE &&
                      styles.policyChoiceSelected,
                  ]}
                  onPress={() => setSelectedPolicy(ConflictPolicy.REPLACE)}
                >
                  <Text style={styles.policyChoiceTitle}>Replace</Text>
                  <Text style={styles.policyChoiceDesc}>
                    Overwrite local file with cloud copy
                  </Text>
                </TouchableOpacity>
              </View>

              {restoreStatus ? (
                <Text style={styles.modalStatusText}>{restoreStatus}</Text>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setRestoreModalItem(null)}
                  disabled={restoring}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalConfirmButton,
                    restoring && styles.buttonDisabled,
                  ]}
                  onPress={handleExecuteRestore}
                  disabled={restoring}
                >
                  <Text style={styles.modalConfirmButtonText}>
                    {restoring ? 'Restoring...' : 'Download & Restore'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

export const GalleryScreen = CloudGalleryScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerEyebrow: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  headerTitle: {
    color: '#f9fafb',
    fontSize: 26,
    fontWeight: '800',
  },
  rescanButton: {
    backgroundColor: '#16221c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#243029',
  },
  rescanButtonText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
  },
  headerDesc: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  permissionAlertCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginBottom: 16,
  },
  permissionAlertHeader: {
    marginBottom: 6,
  },
  permissionAlertTitle: {
    color: '#f87171',
    fontSize: 15,
    fontWeight: '700',
  },
  permissionAlertDesc: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  permissionActionButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  permissionActionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  partialAlertCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  partialAlertTextCol: {
    flex: 1,
  },
  partialAlertTitle: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  partialAlertDesc: {
    color: '#d1d5db',
    fontSize: 12,
  },
  partialActionBtn: {
    backgroundColor: '#d97706',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  partialActionText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  statusBarCard: {
    backgroundColor: '#121a15',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#243029',
    marginBottom: 16,
  },
  progressSection: {
    width: '100%',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
    marginRight: 6,
  },
  statusLabelActive: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusPercent: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '700',
  },
  statusFileName: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: '#1f2e24',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 3,
  },
  statusBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusMeta: {
    color: '#9ca3af',
    fontSize: 12,
  },
  pauseSmallButton: {
    backgroundColor: '#1f2e24',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pauseSmallButtonText: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '600',
  },
  pausedSection: {
    width: '100%',
  },
  statusDotPaused: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
    marginRight: 6,
  },
  statusLabelPaused: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resumeSmallButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  resumeSmallButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  statusPausedDesc: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
  readySection: {
    width: '100%',
  },
  statusInfoCol: {
    flex: 1,
  },
  readyTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  readySub: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  backupActionButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backupActionButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  syncedSection: {
    paddingVertical: 2,
  },
  syncedText: {
    color: '#9ca3af',
    fontSize: 13,
  },
  viewTabs: {
    flexDirection: 'row',
    backgroundColor: '#121a15',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#243029',
  },
  viewTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 7,
  },
  viewTabActive: {
    backgroundColor: '#1b2a20',
  },
  viewTabText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  viewTabTextActive: {
    color: '#34d399',
    fontWeight: '700',
  },
  searchInput: {
    backgroundColor: '#121a15',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 10,
    color: '#f9fafb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  filterPillsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#121a15',
    borderWidth: 1,
    borderColor: '#243029',
    marginRight: 8,
  },
  filterPillActive: {
    backgroundColor: '#1b3327',
    borderColor: '#34d399',
  },
  filterPillText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#34d399',
    fontWeight: '700',
  },
  folderScroll: {
    marginBottom: 14,
  },
  folderChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#121a15',
    borderWidth: 1,
    borderColor: '#243029',
    marginRight: 6,
  },
  folderChipActive: {
    backgroundColor: '#243029',
    borderColor: '#6b7280',
  },
  folderChipText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  folderChipTextActive: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  itemsList: {
    marginTop: 4,
  },
  emptyCard: {
    backgroundColor: '#121a15',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#243029',
    marginTop: 8,
  },
  emptyTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  scanNowButton: {
    backgroundColor: '#16221c',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#34d399',
  },
  scanNowButtonText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '600',
  },
  mediaItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121a15',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#243029',
  },
  mediaItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#1b2a20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  mediaItemIconText: {
    fontSize: 18,
  },
  mediaItemDetails: {
    flex: 1,
    marginRight: 8,
  },
  mediaItemName: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  mediaItemPath: {
    color: '#6b7280',
    fontSize: 11,
    marginBottom: 3,
  },
  mediaItemMeta: {
    color: '#9ca3af',
    fontSize: 11,
  },
  restoreItemButton: {
    backgroundColor: '#1b3327',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#34d399',
  },
  restoreItemButtonText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
  },
  deviceStatusCol: {
    alignItems: 'flex-end',
  },
  badgeBackedUp: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeBackedUpText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '600',
  },
  badgePending: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgePendingText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeExcluded: {
    backgroundColor: 'rgba(107, 114, 128, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeExcludedText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalSheet: {
    backgroundColor: '#121a15',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#243029',
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSub: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  modalPath: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 16,
  },
  modalFolderSection: {
    marginBottom: 16,
  },
  folderToggleHeader: {
    paddingVertical: 8,
  },
  folderToggleHeaderText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '600',
  },
  modalFolderScroll: {
    maxHeight: 150,
    marginTop: 6,
    backgroundColor: '#0a0f0d',
    borderRadius: 8,
    padding: 8,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#16221c',
  },
  folderInfoCol: {
    flex: 1,
  },
  folderRowTitle: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '600',
  },
  folderRowMeta: {
    color: '#6b7280',
    fontSize: 11,
  },
  policyHeading: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  policyChoices: {
    marginBottom: 16,
  },
  policyChoice: {
    backgroundColor: '#0a0f0d',
    borderWidth: 1,
    borderColor: '#243029',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  policyChoiceSelected: {
    borderColor: '#10b981',
    backgroundColor: '#162b20',
  },
  policyChoiceTitle: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  policyChoiceDesc: {
    color: '#9ca3af',
    fontSize: 11,
  },
  modalStatusText: {
    color: '#34d399',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  modalCancelButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  modalConfirmButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalConfirmButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
