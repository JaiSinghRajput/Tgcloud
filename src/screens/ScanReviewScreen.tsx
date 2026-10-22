import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { ScanReviewResult, FolderSummary } from '../domain/media/scanner';

interface ScanReviewScreenProps {
  scanReview: ScanReviewResult;
  onToggleFolderExclusion: (folderKey: string) => void;
  onConfirmBackup: () => void;
  onRescan: () => void;
}

export const ScanReviewScreen: React.FC<ScanReviewScreenProps> = ({
  scanReview,
  onToggleFolderExclusion,
  onConfirmBackup,
  onRescan,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>STEP 2 · SCAN REVIEW</Text>
        <Text style={styles.headerTitle}>Gallery Scan Review</Text>
        <Text style={styles.headerDesc}>
          Review discovered media collections and customize folder exclusions.
          No uploads will begin until you explicitly confirm below.
        </Text>
      </View>

      {/* Summary Banner */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryNum}>{scanReview.eligibleCount}</Text>
            <Text style={styles.summaryLabel}>Eligible Items</Text>
            <Text style={styles.summaryBytes}>
              {formatBytes(scanReview.eligibleBytes)}
            </Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryCol}>
            <Text style={[styles.summaryNum, styles.summaryNumExcluded]}>
              {scanReview.excludedCount}
            </Text>
            <Text style={styles.summaryLabel}>Excluded Items</Text>
            <Text style={styles.summaryBytes}>
              {formatBytes(scanReview.excludedBytes)}
            </Text>
          </View>
        </View>
      </View>

      {/* Folders Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Detected Folders ({scanReview.folders.length})
        </Text>
        <TouchableOpacity onPress={onRescan}>
          <Text style={styles.rescanText}>Rescan</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.folderList}>
        {scanReview.folders.map((folder: FolderSummary) => (
          <View key={folder.folderKey} style={styles.folderCard}>
            <View style={styles.folderInfo}>
              <View style={styles.folderTitleRow}>
                <Text style={styles.folderTitle}>{folder.displayLabel}</Text>
                {folder.isExcluded && (
                  <View style={styles.excludedTag}>
                    <Text style={styles.excludedTagText}>EXCLUDED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.folderPath} numberOfLines={1}>
                {folder.folderKey}
              </Text>
              <Text style={styles.folderStats}>
                {folder.itemCount} items · {formatBytes(folder.byteSize)}
              </Text>
            </View>

            <Switch
              value={!folder.isExcluded}
              onValueChange={() => onToggleFolderExclusion(folder.folderKey)}
              trackColor={{ false: '#374151', true: '#047857' }}
              thumbColor={!folder.isExcluded ? '#10b981' : '#9ca3af'}
            />
          </View>
        ))}
      </View>

      {/* Explicit Confirmation Gate */}
      <View style={styles.confirmationBox}>
        <Text style={styles.confirmationTitle}>Explicit Confirmation Gate</Text>
        <Text style={styles.confirmationDesc}>
          By tapping Confirm & Start Backup, the eligible items will be
          persisted to your local queue and transferred to your private Telegram
          channels.
        </Text>

        <TouchableOpacity
          style={styles.confirmButton}
          onPress={onConfirmBackup}
        >
          <Text style={styles.confirmButtonText}>
            Confirm & Start Backup ({scanReview.eligibleCount} items ·{' '}
            {formatBytes(scanReview.eligibleBytes)})
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
    marginBottom: 20,
  },
  headerEyebrow: {
    color: '#10b981',
    fontSize: 12,
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
    marginTop: 6,
  },
  summaryCard: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 48,
    backgroundColor: '#243029',
  },
  summaryNum: {
    color: '#34d399',
    fontSize: 26,
    fontWeight: '800',
  },
  summaryLabel: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  summaryBytes: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#f3f4f6',
    fontSize: 16,
    fontWeight: '700',
  },
  rescanText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '600',
  },
  folderList: {
    gap: 10,
    marginBottom: 24,
  },
  folderCard: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  folderInfo: {
    flex: 1,
    marginRight: 14,
  },
  folderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  folderTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
  },
  excludedTag: {
    backgroundColor: '#374151',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  excludedTagText: {
    color: '#d1d5db',
    fontSize: 10,
    fontWeight: '700',
  },
  folderPath: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 4,
  },
  folderStats: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '500',
  },
  confirmationBox: {
    backgroundColor: '#16281e',
    borderColor: '#047857',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
  },
  confirmationTitle: {
    color: '#34d399',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  confirmationDesc: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  confirmButton: {
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryNumExcluded: {
    color: '#9ca3af',
  },
});
