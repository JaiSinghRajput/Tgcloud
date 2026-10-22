import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { BackupTransferProgress } from '../domain/backup/engine';
import { DbUploadJob } from '../domain/database/types';
import { UploadJobState } from '../domain/backup/stateMachine';

export interface BackupActivityScreenProps {
  activeProgress?: BackupTransferProgress | null;
  isPaused: boolean;
  queueStats: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    total: number;
  };
  jobs?: DbUploadJob[];
  onTogglePause: () => void;
  onCancelAll: () => void;
  onRetryFailed: () => void;
}

export const BackupActivityScreen: React.FC<BackupActivityScreenProps> = ({
  activeProgress,
  isPaused,
  queueStats,
  jobs = [],
  onTogglePause,
  onCancelAll,
  onRetryFailed,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const percent =
    activeProgress && activeProgress.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (activeProgress.bytesUploaded / activeProgress.totalBytes) * 100,
          ),
        )
      : activeProgress
      ? 50
      : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Backup Activity</Text>
        <Text style={styles.subtitle}>
          Persistent queue status, transfer progress, and controlled uploads.
        </Text>
      </View>

      {/* Active Transfer Card */}
      {activeProgress ? (
        <View style={styles.activeCard}>
          <View style={styles.activeHeader}>
            <View style={styles.activePulseDot} />
            <Text style={styles.activeTitle}>
              {isPaused ? 'Transfer Paused' : 'Transferring Now'}
            </Text>
            <View style={styles.stateBadge}>
              <Text style={styles.stateBadgeText}>
                {activeProgress.state || 'Uploading'}
              </Text>
            </View>
          </View>

          <Text style={styles.activeFilename} numberOfLines={1}>
            {activeProgress.displayName}
          </Text>

          {/* Progress Bar */}
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${percent}%` }]} />
          </View>

          <View style={styles.progressMetaRow}>
            <Text style={styles.progressMetaText}>
              {formatBytes(activeProgress.bytesUploaded)} of{' '}
              {formatBytes(activeProgress.totalBytes)}
            </Text>
            <Text style={styles.progressPercentText}>{percent}%</Text>
          </View>
        </View>
      ) : (
        <View style={styles.idleCard}>
          <Text style={styles.idleIcon}>
            {isPaused ? '⏸️' : queueStats.pending > 0 ? '⏳' : '✓'}
          </Text>
          <Text style={styles.idleTitle}>
            {isPaused
              ? 'Backup is Paused'
              : queueStats.pending > 0
              ? 'Transfers Waiting in Queue'
              : 'All Queued Media Synchronized'}
          </Text>
          <Text style={styles.idleSubtitle}>
            {isPaused
              ? 'Tap Resume Backup to continue uploading selected media.'
              : queueStats.pending > 0
              ? `${queueStats.pending} items waiting to be prepared and uploaded.`
              : 'No pending uploads. Select photos in the Gallery to start backing up.'}
          </Text>
        </View>
      )}

      {/* Queue Stat Cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{queueStats.completed}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, styles.statNumberRemaining]}>
            {queueStats.pending + queueStats.running}
          </Text>
          <Text style={styles.statLabel}>Remaining</Text>
        </View>
        <View style={styles.statBox}>
          <Text
            style={[
              styles.statNumber,
              queueStats.failed > 0
                ? styles.statNumberFailed
                : styles.statNumberZero,
            ]}
          >
            {queueStats.failed}
          </Text>
          <Text style={styles.statLabel}>Failed</Text>
        </View>
      </View>

      {/* Queue Controls */}
      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[
            styles.controlBtn,
            isPaused ? styles.controlBtnResume : styles.controlBtnPause,
          ]}
          onPress={onTogglePause}
        >
          <Text style={styles.controlBtnText}>
            {isPaused ? '▶ Resume Backup' : '⏸ Pause Backup'}
          </Text>
        </TouchableOpacity>

        {queueStats.pending > 0 && (
          <TouchableOpacity
            style={[styles.controlBtn, styles.controlBtnCancel]}
            onPress={onCancelAll}
          >
            <Text style={styles.controlBtnText}>✕ Cancel Pending</Text>
          </TouchableOpacity>
        )}

        {queueStats.failed > 0 && (
          <TouchableOpacity
            style={[styles.controlBtn, styles.controlBtnRetry]}
            onPress={onRetryFailed}
          >
            <Text style={styles.controlBtnText}>🔄 Retry Failed</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recent Queue Items */}
      {jobs.length > 0 && (
        <View style={styles.jobsSection}>
          <Text style={styles.jobsSectionTitle}>Queue History & Items</Text>
          {jobs.slice(0, 20).map(job => (
            <View key={job.id} style={styles.jobRow}>
              <View style={styles.jobInfo}>
                <Text style={styles.jobIdText} numberOfLines={1}>
                  Media ID: {job.mediaItemId}
                </Text>
                <Text style={styles.jobSubText}>
                  Attempts: {job.attemptCount}
                  {job.lastErrorSummary ? ` · ${job.lastErrorSummary}` : ''}
                </Text>
              </View>
              <View
                style={[
                  styles.jobStatusChip,
                  job.state === UploadJobState.COMPLETED
                    ? styles.statusCompleted
                    : job.state === UploadJobState.RUNNING ||
                      job.state === UploadJobState.VERIFYING
                    ? styles.statusRunning
                    : job.state === UploadJobState.FAILED_PERMANENT ||
                      job.state === UploadJobState.FAILED_RETRYABLE
                    ? styles.statusFailed
                    : styles.statusPending,
                ]}
              >
                <Text style={styles.jobStatusText}>{job.state}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  activeCard: {
    backgroundColor: '#16221c',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#243029',
    marginBottom: 16,
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  activePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
    marginRight: 8,
  },
  activeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34d399',
    flex: 1,
  },
  stateBadge: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stateBadgeText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  activeFilename: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#243029',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 4,
  },
  progressMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressMetaText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  progressPercentText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
  },
  idleCard: {
    backgroundColor: '#16221c',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#243029',
    marginBottom: 16,
  },
  idleIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  idleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  idleSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#111814',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#243029',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: '#10b981',
  },
  statNumberRemaining: {
    color: '#38bdf8',
  },
  statNumberFailed: {
    color: '#ef4444',
  },
  statNumberZero: {
    color: '#9ca3af',
  },
  statLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
    fontWeight: '600',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnPause: {
    backgroundColor: '#1f2937',
  },
  controlBtnResume: {
    backgroundColor: '#10b981',
  },
  controlBtnCancel: {
    backgroundColor: '#374151',
  },
  controlBtnRetry: {
    backgroundColor: '#2563eb',
  },
  controlBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  jobsSection: {
    marginTop: 10,
  },
  jobsSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 10,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111814',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e2923',
  },
  jobInfo: {
    flex: 1,
    marginRight: 10,
  },
  jobIdText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  jobSubText: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  jobStatusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusRunning: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
  },
  statusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  statusPending: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
  },
  jobStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
});
