import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { ConflictPolicy } from '../domain/backup/stateMachine';

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

interface CloudGalleryScreenProps {
  items: CloudMediaItem[];
  onRestoreItem: (
    item: CloudMediaItem,
    policy: ConflictPolicy,
  ) => Promise<boolean>;
}

export const CloudGalleryScreen: React.FC<CloudGalleryScreenProps> = ({
  items,
  onRestoreItem,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>(
    'all',
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string>('all');

  const [restoreModalItem, setRestoreModalItem] =
    useState<CloudMediaItem | null>(null);
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

  // Derive unique folders from virtual paths
  const folders = Array.from(
    new Set(
      items.map(i => {
        const parts = i.relativePath.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root';
      }),
    ),
  );

  // Filter items
  const filteredItems = items.filter(item => {
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>CLOUD REPOSITORY</Text>
          <Text style={styles.headerTitle}>Backed-Up Gallery</Text>
          <Text style={styles.headerDesc}>
            Browsing virtual gallery reconstructed from your private Telegram
            channel metadata.
          </Text>
        </View>

        {/* Search Bar */}
        <TextInput
          style={styles.searchInput}
          placeholder="Search by filename or relative path..."
          placeholderTextColor="#6b7280"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        {/* Filter Pills */}
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
              All ({items.length})
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

        {/* Folder Selector (Horizontal scroll) */}
        {folders.length > 1 && (
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
            {folders.map(folder => (
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

        {/* Media Items List */}
        <View style={styles.itemsList}>
          {filteredItems.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No backed-up items match your filters
              </Text>
              <Text style={styles.emptySubtitle}>
                Sync completed items from your dashboard to view them here.
              </Text>
            </View>
          ) : (
            filteredItems.map(item => (
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
                    {formatBytes(item.sizeBytes)} ·{' '}
                    {formatDate(item.modifiedAtMs)}
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
      </ScrollView>

      {/* Restore Modal Sheet with Conflict Policy */}
      {restoreModalItem && (
        <Modal transparent animationType="slide" visible={!!restoreModalItem}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Restore Media Item</Text>
              <Text style={styles.modalSub}>
                {restoreModalItem.originalName}
              </Text>
              <Text style={styles.modalPath}>
                Target: {restoreModalItem.relativePath}
              </Text>

              <Text style={styles.policyHeading}>
                COLLISION CONFLICT POLICY
              </Text>
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
  headerEyebrow: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  headerTitle: {
    color: '#f9fafb',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerDesc: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  searchInput: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#f3f4f6',
    fontSize: 14,
    marginBottom: 14,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#16221c',
    borderColor: '#243029',
    borderWidth: 1,
  },
  filterPillActive: {
    backgroundColor: '#047857',
    borderColor: '#10b981',
  },
  filterPillText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  folderScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  folderChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#121815',
    marginRight: 8,
    borderColor: '#243029',
    borderWidth: 1,
  },
  folderChipActive: {
    borderColor: '#047857',
  },
  folderChipText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  folderChipTextActive: {
    color: '#34d399',
    fontWeight: '600',
  },
  itemsList: {
    gap: 10,
  },
  emptyCard: {
    backgroundColor: '#121815',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    borderColor: '#243029',
    borderWidth: 1,
  },
  emptyTitle: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: '#6b7280',
    fontSize: 13,
  },
  mediaItemCard: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaItemIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#16281e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  mediaItemIconText: {
    fontSize: 20,
  },
  mediaItemDetails: {
    flex: 1,
    marginRight: 10,
  },
  mediaItemName: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  mediaItemPath: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  mediaItemMeta: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 3,
  },
  restoreItemButton: {
    backgroundColor: '#047857',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  restoreItemButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#121815',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: '#243029',
    borderWidth: 1,
    padding: 24,
  },
  modalTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '800',
  },
  modalSub: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  modalPath: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
  },
  policyHeading: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  policyChoices: {
    gap: 8,
    marginBottom: 16,
  },
  policyChoice: {
    backgroundColor: '#16221c',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  policyChoiceSelected: {
    borderColor: '#10b981',
    backgroundColor: '#142a1f',
  },
  policyChoiceTitle: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '700',
  },
  policyChoiceDesc: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  modalStatusText: {
    color: '#a7f3d0',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: '#374151',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
  },
  modalConfirmButton: {
    flex: 2,
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
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
