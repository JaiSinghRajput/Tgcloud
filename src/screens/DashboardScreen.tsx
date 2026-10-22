import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { DashboardMetrics } from '../domain/database/types';
import { NetworkPolicy } from '../domain/backup/stateMachine';
import { BackupTransferProgress } from '../domain/backup/engine';

interface DashboardScreenProps {
  metrics: DashboardMetrics;
  networkPolicy: NetworkPolicy;
  isPaused: boolean;
  activeProgress: BackupTransferProgress | null;
  onTogglePause: () => void;
  onTriggerScan: () => void;
  onNavigateToScanReview: () => void;
  onNavigateToTelegram: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  metrics,
  networkPolicy,
  isPaused,
  activeProgress,
  onTogglePause,
  onTriggerScan,
  onNavigateToScanReview,
  onNavigateToTelegram,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatLastBackup = (ms: number | null): string => {
    if (!ms) return 'Never';
    return new Date(ms).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.statusDot,
              isPaused ? styles.statusDotPaused : styles.statusDotActive,
            ]}
          />
          <Text style={styles.badgeText}>
            {isPaused ? 'BACKUP PAUSED' : 'BACKUP ENGINE ACTIVE'}
          </Text>
        </View>
        <Text style={styles.title}>Backup Dashboard</Text>
        <Text style={styles.subtitle}>
          Private photo & video sync directly to your Telegram channels.
        </Text>
      </View>

      {/* Network Policy & Pause/Resume Banner */}
      <View style={styles.policyCard}>
        <View style={styles.policyRow}>
          <View>
            <Text style={styles.policyLabel}>NETWORK POLICY</Text>
            <Text style={styles.policyValue}>
              {networkPolicy === NetworkPolicy.WIFI_ONLY
                ? 'Wi-Fi Only'
                : 'Wi-Fi + Mobile Data'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.pauseButton,
              isPaused ? styles.resumeButton : styles.pauseButtonActive,
            ]}
            onPress={onTogglePause}
          >
            <Text style={styles.pauseButtonText}>
              {isPaused ? 'Resume Sync' : 'Pause Sync'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* In-Flight Active Transfer Progress Card */}
      {activeProgress && (
        <View style={styles.activeCard}>
          <View style={styles.activeTopRow}>
            <Text style={styles.activeLabel}>CURRENTLY UPLOADING</Text>
            <Text style={styles.activePercent}>
              {activeProgress.totalBytes > 0
                ? `${Math.round(
                    (activeProgress.bytesUploaded / activeProgress.totalBytes) *
                      100,
                  )}%`
                : 'Starting...'}
            </Text>
          </View>
          <Text style={styles.activeName} numberOfLines={1}>
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
          <Text style={styles.activeSize}>
            {formatBytes(activeProgress.bytesUploaded)} /{' '}
            {formatBytes(activeProgress.totalBytes)}
          </Text>
        </View>
      )}

      {/* Metric Grid (Persisted States) */}
      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricNum}>{metrics.totalDiscovered}</Text>
          <Text style={styles.metricLabel}>Discovered</Text>
          <Text style={styles.metricDesc}>In local gallery</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={[styles.metricNum, styles.metricNumBackedUp]}>
            {metrics.backedUp}
          </Text>
          <Text style={styles.metricLabel}>Backed Up</Text>
          <Text style={styles.metricDesc}>Verified on Telegram</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={[styles.metricNum, styles.metricNumPending]}>
            {metrics.pending}
          </Text>
          <Text style={styles.metricLabel}>Pending</Text>
          <Text style={styles.metricDesc}>Queued for transfer</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={[styles.metricNum, styles.metricNumUploading]}>
            {metrics.uploading}
          </Text>
          <Text style={styles.metricLabel}>In Flight</Text>
          <Text style={styles.metricDesc}>Uploading / Verifying</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={[styles.metricNum, styles.metricNumExcluded]}>
            {metrics.excluded}
          </Text>
          <Text style={styles.metricLabel}>Excluded</Text>
          <Text style={styles.metricDesc}>By folder policy</Text>
        </View>

        <View style={styles.metricCard}>
          <Text
            style={[
              styles.metricNum,
              metrics.failed > 0
                ? styles.metricNumFailed
                : styles.metricNumExcluded,
            ]}
          >
            {metrics.failed}
          </Text>
          <Text style={styles.metricLabel}>Failed</Text>
          <Text style={styles.metricDesc}>Needs user attention</Text>
        </View>
      </View>

      {/* Last Backup & Fast Actions */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Successful Backup:</Text>
          <Text style={styles.infoValue}>
            {formatLastBackup(metrics.lastBackupTimeMs)}
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={onTriggerScan}>
          <Text style={styles.actionButtonText}>Rescan Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButtonSecondary}
          onPress={onNavigateToScanReview}
        >
          <Text style={styles.actionButtonSecondaryText}>
            Review Folders & Exclusions
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButtonOutline}
          onPress={onNavigateToTelegram}
        >
          <Text style={styles.actionButtonOutlineText}>
            Telegram Channels & TDLib PoC
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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    color: '#f9fafb',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  policyCard: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  policyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  policyLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  policyValue: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  pauseButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pauseButtonActive: {
    backgroundColor: '#374151',
  },
  resumeButton: {
    backgroundColor: '#047857',
  },
  pauseButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  activeCard: {
    backgroundColor: '#142a1f',
    borderColor: '#047857',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  activeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  activeLabel: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  activePercent: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '700',
  },
  activeName: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#1f3d2f',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 4,
  },
  activeSize: {
    color: '#a7f3d0',
    fontSize: 12,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  metricNum: {
    color: '#f9fafb',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 32,
  },
  metricLabel: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  metricDesc: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
  },
  infoValue: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '700',
  },
  actionsContainer: {
    gap: 10,
  },
  actionButton: {
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  actionButtonSecondary: {
    backgroundColor: '#1f2e26',
    borderColor: '#047857',
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionButtonSecondaryText: {
    color: '#6ee7b7',
    fontSize: 15,
    fontWeight: '700',
  },
  actionButtonOutline: {
    backgroundColor: 'transparent',
    borderColor: '#374151',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionButtonOutlineText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  statusDotActive: {
    backgroundColor: '#10b981',
  },
  statusDotPaused: {
    backgroundColor: '#f59e0b',
  },
  metricNumBackedUp: {
    color: '#6ee7b7',
  },
  metricNumPending: {
    color: '#60a5fa',
  },
  metricNumUploading: {
    color: '#f59e0b',
  },
  metricNumExcluded: {
    color: '#9ca3af',
  },
  metricNumFailed: {
    color: '#ef4444',
  },
});
