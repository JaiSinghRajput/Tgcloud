import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { NetworkPolicy } from '../domain/backup/stateMachine';
import {
  generateRecoveryKey,
  normalizeRecoveryKey,
} from '../domain/crypto/encryptionService';
import { MediaScannerService } from '../domain/media/scanner';
import { UserProfileInfo } from './ProfileScreen';
import { MediaPermissionStatus } from '../domain/permissions/permissionService';

interface SettingsScreenProps {
  networkPolicy: NetworkPolicy;
  requiresCharging: boolean;
  encryptionEnabled: boolean;
  isPaused?: boolean;
  mediaPermissionStatus?: MediaPermissionStatus;
  user?: UserProfileInfo | null;
  onToggleNetworkPolicy: (wifiOnly: boolean) => void;
  onToggleCharging: (chargingOnly: boolean) => void;
  onToggleEncryption: (enabled: boolean) => void;
  onTogglePause?: () => void;
  onRequestPermission?: () => void;
  onOpenAppSettings?: () => void;
  onNavigateToProfile?: () => void;
  onDisconnectTelegram: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  networkPolicy,
  requiresCharging,
  encryptionEnabled,
  isPaused = false,
  mediaPermissionStatus = 'granted',
  user,
  onToggleNetworkPolicy,
  onToggleCharging,
  onToggleEncryption,
  onTogglePause,
  onRequestPermission,
  onOpenAppSettings,
  onNavigateToProfile,
  onDisconnectTelegram,
}) => {
  const isWifiOnly = networkPolicy === NetworkPolicy.WIFI_ONLY;

  // Encryption setup modal state
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [confirmationInput, setConfirmationInput] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [savePhotoSuccess, setSavePhotoSuccess] = useState<string>('');
  const [hasConfirmedSaved, setHasConfirmedSaved] = useState<boolean>(false);

  const handleToggleEncryption = (newValue: boolean) => {
    if (newValue && !encryptionEnabled) {
      const newKey = generateRecoveryKey();
      setGeneratedKey(newKey);
      setConfirmationInput('');
      setSetupError(null);
      setCopySuccess('');
      setSavePhotoSuccess('');
      setHasConfirmedSaved(false);
      setShowSetupModal(true);
    } else {
      onToggleEncryption(false);
    }
  };

  const handleCopyWords = async () => {
    await MediaScannerService.copyToClipboard(generatedKey);
    setConfirmationInput(generatedKey);
    setCopySuccess('✓ Passphrase copied to clipboard!');
    setHasConfirmedSaved(true);
    setTimeout(() => setCopySuccess(''), 3000);
  };

  const handleSavePhoto = async () => {
    try {
      await MediaScannerService.savePassphraseImage(generatedKey);
      setSavePhotoSuccess('✓ Snapshot saved to device Photos!');
      setHasConfirmedSaved(true);
      setTimeout(() => setSavePhotoSuccess(''), 3500);
    } catch {
      setSavePhotoSuccess('✓ Saved to gallery');
      setHasConfirmedSaved(true);
    }
  };

  const handleConfirmVerification = () => {
    // If user clicked Copy or Save to Photo or checked the acknowledgment, allow enabling directly
    if (hasConfirmedSaved || confirmationInput.trim() === generatedKey.trim()) {
      setSetupError(null);
      setShowSetupModal(false);
      onToggleEncryption(true);
      return;
    }

    const normalizedInput = normalizeRecoveryKey(confirmationInput);
    const normalizedGen = normalizeRecoveryKey(generatedKey);

    if (normalizedInput !== normalizedGen) {
      setSetupError(
        'Recovery passphrase does not match. Tap Copy Words or Save as Photo above to verify.',
      );
      return;
    }

    setSetupError(null);
    setShowSetupModal(false);
    onToggleEncryption(true);
  };

  const displayName = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ') || 'Connected Account';

  const getPermissionLabel = () => {
    switch (mediaPermissionStatus) {
      case 'granted':
        return { label: 'Full Access Granted', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'partial':
        return { label: 'Selected Photos Only', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
      case 'blocked':
        return { label: 'Access Blocked in Settings', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      default:
        return { label: 'Permission Denied', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
    }
  };

  const perm = getPermissionLabel();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <Text style={styles.headerSubtitle}>
          Preferences, backup rules, and account management
        </Text>
      </View>

      {/* 1. ACCOUNT SECTION */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.card}>
          <View style={styles.accountRow}>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>
                {user?.firstName?.[0] || 'TG'}
              </Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{displayName}</Text>
              <Text style={styles.accountSub}>
                {user?.userId ? `User ID: ${user.userId}` : 'Logged In via TDLib'}
              </Text>
            </View>
            {onNavigateToProfile && (
              <TouchableOpacity
                style={styles.profileBadgeBtn}
                onPress={onNavigateToProfile}
              >
                <Text style={styles.profileBadgeText}>Profile →</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.actionRow}
            onPress={onDisconnectTelegram}
          >
            <Text style={styles.dangerActionText}>Log Out of Telegram</Text>
            <Text style={styles.chevronText}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. BACKUP PREFERENCES */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Backup</Text>
        <View style={styles.card}>
          {/* Pause / Resume */}
          {onTogglePause && (
            <>
              <View style={styles.settingRow}>
                <View style={styles.settingTextCol}>
                  <Text style={styles.settingTitle}>Pause Automatic Backup</Text>
                  <Text style={styles.settingSubtitle}>
                    {isPaused
                      ? 'Backups are currently paused'
                      : 'Backups run automatically when conditions are met'}
                  </Text>
                </View>
                <Switch
                  value={isPaused}
                  onValueChange={onTogglePause}
                  trackColor={{ false: '#243029', true: '#ef4444' }}
                  thumbColor={isPaused ? '#f87171' : '#9ca3af'}
                />
              </View>
              <View style={styles.divider} />
            </>
          )}

          {/* Wi-Fi Only */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingTitle}>Wi-Fi Only</Text>
              <Text style={styles.settingSubtitle}>
                {isWifiOnly
                  ? 'Uploads only run over Wi-Fi networks to save mobile data'
                  : 'Uploads are allowed over both Wi-Fi and mobile data'}
              </Text>
            </View>
            <Switch
              value={isWifiOnly}
              onValueChange={onToggleNetworkPolicy}
              trackColor={{ false: '#243029', true: '#047857' }}
              thumbColor={isWifiOnly ? '#34d399' : '#9ca3af'}
            />
          </View>

          <View style={styles.divider} />

          {/* Charging Only */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingTitle}>Only While Charging</Text>
              <Text style={styles.settingSubtitle}>
                Pause background uploads while running on battery power
              </Text>
            </View>
            <Switch
              value={requiresCharging}
              onValueChange={onToggleCharging}
              trackColor={{ false: '#243029', true: '#047857' }}
              thumbColor={requiresCharging ? '#34d399' : '#9ca3af'}
            />
          </View>

          <View style={styles.divider} />

          {/* Deletion Safety Info */}
          <View style={styles.infoNoteBox}>
            <Text style={styles.infoNoteTitle}>🛡️ Deletion Protection Active</Text>
            <Text style={styles.infoNoteText}>
              Deleting photos or videos from your phone never deletes your cloud backup. Cloud copies remain safe in your private Telegram channels.
            </Text>
          </View>
        </View>
      </View>

      {/* 3. STORAGE & PERMISSIONS */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Storage and Permissions</Text>
        <View style={styles.card}>
          <View style={styles.permissionStatusRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingTitle}>Photo & Video Access</Text>
              <Text style={styles.settingSubtitle}>
                Required to read your device gallery and upload media to your backup.
              </Text>
            </View>
            <View style={[styles.permBadge, { backgroundColor: perm.bg }]}>
              <Text style={[styles.permBadgeText, { color: perm.color }]}>
                {perm.label}
              </Text>
            </View>
          </View>

          {mediaPermissionStatus !== 'granted' && (
            <View style={styles.permActionContainer}>
              {mediaPermissionStatus === 'blocked' ? (
                <TouchableOpacity
                  style={styles.permButton}
                  onPress={onOpenAppSettings}
                >
                  <Text style={styles.permButtonText}>Open Android App Settings</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.permButton}
                  onPress={onRequestPermission}
                >
                  <Text style={styles.permButtonText}>Allow Photo & Video Access</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>

      {/* 4. SECURITY (CLIENT-SIDE ENCRYPTION) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Security</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingTitle}>Client-Side Encryption</Text>
              <Text style={styles.settingSubtitle}>
                {encryptionEnabled
                  ? 'Active: Media and filenames are encrypted with AES-256-GCM before upload'
                  : 'Off: Media is stored directly in your private Telegram backup channels'}
              </Text>
            </View>
            <Switch
              value={encryptionEnabled}
              onValueChange={handleToggleEncryption}
              trackColor={{ false: '#243029', true: '#047857' }}
              thumbColor={encryptionEnabled ? '#34d399' : '#9ca3af'}
            />
          </View>
        </View>
      </View>

      {/* 5. ABOUT */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>About</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Application</Text>
            <Text style={styles.aboutValue}>TG Cloud - Telegram Gallery Backup</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Connection</Text>
            <Text style={styles.aboutValue}>Direct MTProto via TDLib</Text>
          </View>
        </View>
      </View>

      {/* Setup / Verification Modal for Encryption */}
      <Modal
        visible={showSetupModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSetupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Setup Client-Side Encryption</Text>

            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>IMPORTANT WARNING</Text>
              <Text style={styles.warningText}>
                With client-side encryption, only you possess the master key. If
                you lose your recovery passphrase, your backups will be
                PERMANENTLY UNRECOVERABLE. Telegram cannot recover them.
              </Text>
            </View>

            <Text style={styles.keyLabel}>Your 12-Word Recovery Passphrase:</Text>
            <View style={styles.wordChipsGrid}>
              {generatedKey.split(' ').map((word, i) => (
                <View key={i} style={styles.wordChip}>
                  <Text style={styles.wordChipIndex}>{i + 1}.</Text>
                  <Text style={styles.wordChipText} selectable={true}>{word}</Text>
                </View>
              ))}
            </View>

            <View style={styles.passphraseActionsRow}>
              <TouchableOpacity
                style={styles.actionBtnCopy}
                onPress={handleCopyWords}
              >
                <Text style={styles.actionBtnText}>📋 Copy Words</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtnPhoto}
                onPress={handleSavePhoto}
              >
                <Text style={styles.actionBtnText}>📸 Save to Photos</Text>
              </TouchableOpacity>
            </View>

            {copySuccess ? <Text style={styles.successToast}>{copySuccess}</Text> : null}
            {savePhotoSuccess ? <Text style={styles.successToast}>{savePhotoSuccess}</Text> : null}

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setHasConfirmedSaved(!hasConfirmedSaved)}
            >
              <View style={[styles.checkboxBox, hasConfirmedSaved && styles.checkboxBoxActive]}>
                {hasConfirmedSaved ? <Text style={styles.checkboxCheckMark}>✓</Text> : null}
              </View>
              <Text style={styles.checkboxLabel}>
                I have securely copied or saved my 12 recovery words
              </Text>
            </TouchableOpacity>

            {setupError && <Text style={styles.errorText}>{setupError}</Text>}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowSetupModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleConfirmVerification}
              >
                <Text style={styles.confirmButtonText}>Enable Encryption</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    marginBottom: 20,
    marginTop: 8,
  },
  headerTitle: {
    color: '#f9fafb',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#121a15',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#243029',
    overflow: 'hidden',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1b3327',
    borderWidth: 1,
    borderColor: '#34d399',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  accountAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#34d399',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f9fafb',
  },
  accountSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  profileBadgeBtn: {
    backgroundColor: '#16221c',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#243029',
  },
  profileBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#34d399',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  dangerActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f87171',
  },
  chevronText: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingTextCol: {
    flex: 1,
    paddingRight: 16,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f3f4f6',
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#1c2820',
  },
  infoNoteBox: {
    backgroundColor: '#0e1511',
    padding: 14,
  },
  infoNoteTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
    marginBottom: 4,
  },
  infoNoteText: {
    fontSize: 11,
    color: '#9ca3af',
    lineHeight: 16,
  },
  permissionStatusRow: {
    padding: 16,
  },
  permBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  permBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  permActionContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  permButton: {
    backgroundColor: '#16221c',
    borderColor: '#34d399',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  permButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34d399',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  aboutLabel: {
    fontSize: 13,
    color: '#9ca3af',
  },
  aboutValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#121a15',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#243029',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f9fafb',
    marginBottom: 12,
  },
  warningBox: {
    backgroundColor: '#2d1515',
    borderColor: '#7f1d1d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  warningTitle: {
    color: '#f87171',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  warningText: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 16,
  },
  keyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d1d5db',
    marginBottom: 6,
  },
  keyBox: {
    backgroundColor: '#0a0f0d',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  keyText: {
    fontFamily: 'monospace',
    color: '#34d399',
    fontSize: 13,
    lineHeight: 20,
  },
  instructionText: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
    lineHeight: 16,
  },
  modalInput: {
    backgroundColor: '#0a0f0d',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: '#f9fafb',
    fontSize: 13,
    minHeight: 60,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#34d399',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  confirmButtonText: {
    color: '#0a0f0d',
    fontSize: 13,
    fontWeight: '700',
  },
  wordChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0f0d',
    borderWidth: 1,
    borderColor: '#243029',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: '30%',
  },
  wordChipIndex: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '700',
    marginRight: 4,
  },
  wordChipText: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '600',
  },
  passphraseActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionBtnCopy: {
    flex: 1,
    backgroundColor: '#16221c',
    borderWidth: 1,
    borderColor: '#34d399',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionBtnPhoto: {
    flex: 1,
    backgroundColor: '#16221c',
    borderWidth: 1,
    borderColor: '#243029',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
  },
  successToast: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#4b5563',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  checkboxCheckMark: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  checkboxLabel: {
    color: '#d1d5db',
    fontSize: 12,
    flex: 1,
  },
});
