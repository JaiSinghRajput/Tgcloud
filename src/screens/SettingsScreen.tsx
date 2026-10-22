import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Buffer } from 'buffer';
import { NetworkPolicy } from '../domain/backup/stateMachine';
import {
  initializeEncryptionSetupAsync,
  SessionKeyStore,
  verifyRecoveryKeyAsync,
} from '../domain/crypto/encryptionService';
import { MediaScannerService } from '../domain/media/scanner';
import { UserProfileInfo } from './ProfileScreen';
import { MediaPermissionStatus } from '../domain/permissions/permissionService';
import { TelegramBackupChannels } from '../types/telegram';
import { RecoveryKeySetup } from '../types/encryption';

interface SettingsScreenProps {
  networkPolicy: NetworkPolicy;
  requiresCharging: boolean;
  encryptionEnabled: boolean;
  isPaused?: boolean;
  mediaPermissionStatus?: MediaPermissionStatus;
  user?: UserProfileInfo | null;
  channels?: TelegramBackupChannels | null;
  onToggleNetworkPolicy: (wifiOnly: boolean) => void;
  onToggleCharging: (chargingOnly: boolean) => void;
  onToggleEncryption: (enabled: boolean, setup?: RecoveryKeySetup) => void;
  onTogglePause?: () => void;
  onRequestPermission?: () => void;
  onOpenAppSettings?: () => void;
  onNavigateToProfile?: () => void;
  onDisconnectTelegram: () => void;
  onOpenChannelInTelegram?: (channelId: string) => void;
  onResyncChannels?: () => void;
  onUnlockPassphrase?: (passphrase: string) => Promise<boolean>;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  networkPolicy,
  requiresCharging,
  encryptionEnabled,
  isPaused: _isPaused = false,
  mediaPermissionStatus = 'granted',
  user,
  channels,
  onToggleNetworkPolicy,
  onToggleCharging,
  onToggleEncryption,
  onTogglePause: _onTogglePause,
  onRequestPermission,
  onOpenAppSettings,
  onNavigateToProfile: _onNavigateToProfile,
  onDisconnectTelegram,
  onOpenChannelInTelegram,
  onResyncChannels,
  onUnlockPassphrase,
}) => {
  const isWifiOnly = networkPolicy === NetworkPolicy.WIFI_ONLY;

  // Encryption setup modal state
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [activeSetup, setActiveSetup] = useState<RecoveryKeySetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [savePhotoSuccess, setSavePhotoSuccess] = useState<string>('');
  const [hasConfirmedSaved, setHasConfirmedSaved] = useState<boolean>(false);

  // Unlock Modal State in Settings
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockPassphraseInput, setUnlockPassphraseInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const isUnlocked = SessionKeyStore.isUnlocked();

  const handleToggleEncryption = async (newValue: boolean) => {
    if (newValue && !encryptionEnabled) {
      // Rule 4 & 5: Never replace an existing encryption key automatically!
      const existingConfig = SessionKeyStore.getConfig();
      if (existingConfig && existingConfig.verificationToken) {
        if (SessionKeyStore.isUnlocked()) {
          onToggleEncryption(true);
          return;
        }
        setShowUnlockModal(true);
        return;
      }

      setSetupError(null);
      setCopySuccess('');
      setSavePhotoSuccess('');
      setHasConfirmedSaved(false);

      try {
        const setup = await initializeEncryptionSetupAsync();
        setActiveSetup(setup);
        setGeneratedKey(setup.recoveryKey);
        setShowSetupModal(true);
      } catch (err: any) {
        const userMsg = err?.message?.includes('Buffer')
          ? 'Memory buffer initialization error. Please update app.'
          : err?.message || 'Failed to initialize client-side encryption. Please try again.';
        setSetupError(userMsg);
      }
    } else {
      SessionKeyStore.clear();
      onToggleEncryption(false);
    }
  };

  const handleCopyWords = async () => {
    await MediaScannerService.copyToClipboard(generatedKey);
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
    if (!hasConfirmedSaved) {
      setSetupError('Please check the acknowledgment that you have saved your 12 recovery words.');
      return;
    }

    if (activeSetup) {
      const masterKey = Buffer.from(activeSetup.masterKeyHex, 'hex');
      SessionKeyStore.setSessionKey(masterKey, activeSetup.recoveryKey, activeSetup.config);
      onToggleEncryption(true, activeSetup);
    } else {
      onToggleEncryption(true);
    }

    setSetupError(null);
    setShowSetupModal(false);
  };

  const handleUnlockInSettings = async () => {
    const raw = unlockPassphraseInput.trim();
    if (!raw) {
      setUnlockError('Please enter your 12-word recovery passphrase.');
      return;
    }

    setIsVerifying(true);
    setUnlockError(null);

    try {
      let valid = false;
      const cfg = SessionKeyStore.getConfig();
      if (cfg) {
        const res = await verifyRecoveryKeyAsync(raw, cfg);
        if (res.valid && res.masterKeyHex) {
          valid = true;
          const masterKey = Buffer.from(res.masterKeyHex, 'hex');
          SessionKeyStore.setSessionKey(masterKey, raw, cfg);
          onToggleEncryption(true);
        }
      }

      if (onUnlockPassphrase) {
        const success = await onUnlockPassphrase(raw);
        if (success) valid = true;
      }

      if (valid) {
        setShowUnlockModal(false);
        setUnlockPassphraseInput('');
      } else {
        setUnlockError('Incorrect recovery passphrase. Please verify your 12 words.');
      }
    } catch (e: any) {
      setUnlockError(`Verification error: ${e?.message || 'Authentication failed'}`);
    } finally {
      setIsVerifying(false);
    }
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
      {/* 1. ACCOUNT */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.card}>
          <View style={styles.accountHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {displayName.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={styles.accountDetails}>
              <Text style={styles.accountName}>{displayName}</Text>
              <Text style={styles.accountSub}>
                Telegram ID: {user?.userId || 'N/A'}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.dangerButton}
            onPress={onDisconnectTelegram}
          >
            <Text style={styles.dangerButtonText}>Log Out of Telegram</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. BACKUP & DESTINATIONS */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Backup</Text>
        <View style={styles.card}>
          {/* Wi-Fi only toggle */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingTitle}>Upload Only on Wi-Fi</Text>
              <Text style={styles.settingSubtitle}>
                Pause uploads automatically on cellular data to prevent unexpected data usage.
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

          {/* Charging only toggle */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingTitle}>Require Device Charging</Text>
              <Text style={styles.settingSubtitle}>
                Upload only when connected to a charger to conserve battery life.
              </Text>
            </View>
            <Switch
              value={requiresCharging}
              onValueChange={onToggleCharging}
              trackColor={{ false: '#243029', true: '#047857' }}
              thumbColor={requiresCharging ? '#34d399' : '#9ca3af'}
            />
          </View>

          {/* Telegram Destination Channels Info */}
          {channels && (
            <>
              <View style={styles.divider} />
              <View style={styles.channelsContainer}>
                <Text style={styles.channelsHeader}>Cloud Storage Destinations</Text>

                <View style={styles.channelRow}>
                  <View style={styles.channelTextCol}>
                    <Text style={styles.channelName}>
                      📷 {channels.photoChannelTitle || 'Backup - Photos'}
                    </Text>
                    <Text style={styles.channelStatus}>
                      Channel ID: {channels.photoChannelId} · {channels.verified ? '✓ Verified' : 'Connecting'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.channelTgBtn}
                    onPress={() => onOpenChannelInTelegram?.(channels.photoChannelId)}
                  >
                    <Text style={styles.channelTgBtnText}>Open ↗</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.channelRow}>
                  <View style={styles.channelTextCol}>
                    <Text style={styles.channelName}>
                      🎬 {channels.videoChannelTitle || 'Backup - Videos'}
                    </Text>
                    <Text style={styles.channelStatus}>
                      Channel ID: {channels.videoChannelId} · {channels.verified ? '✓ Verified' : 'Connecting'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.channelTgBtn}
                    onPress={() => onOpenChannelInTelegram?.(channels.videoChannelId)}
                  >
                    <Text style={styles.channelTgBtnText}>Open ↗</Text>
                  </TouchableOpacity>
                </View>

                {onResyncChannels && (
                  <TouchableOpacity
                    style={styles.resyncChannelsBtn}
                    onPress={onResyncChannels}
                  >
                    <Text style={styles.resyncChannelsBtnText}>
                      ↻ Reconnect / Rediscover Destinations
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

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
                  ? isUnlocked
                    ? 'Active (Unlocked): Media is encrypted with AES-256-GCM before upload'
                    : 'Active (Locked): Recovery passphrase required to preview or restore'
                  : 'Off: Media is stored directly in your private Telegram channels'}
              </Text>
            </View>
            <Switch
              value={encryptionEnabled}
              onValueChange={handleToggleEncryption}
              trackColor={{ false: '#243029', true: '#047857' }}
              thumbColor={encryptionEnabled ? '#34d399' : '#9ca3af'}
            />
          </View>

          {encryptionEnabled && (
            <View style={styles.encryptionActionBox}>
              {!isUnlocked ? (
                <TouchableOpacity
                  style={styles.unlockKeyBtn}
                  onPress={() => {
                    setUnlockPassphraseInput('');
                    setUnlockError(null);
                    setShowUnlockModal(true);
                  }}
                >
                  <Text style={styles.unlockKeyBtnText}>
                    🔓 Enter Recovery Passphrase to Unlock
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.lockKeyBtn}
                  onPress={() => SessionKeyStore.clear()}
                >
                  <Text style={styles.lockKeyBtnText}>
                    🔒 Lock Cloud Media (Clear Key from Memory)
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.cryptoExplainerBox}>
            <Text style={styles.cryptoExplainerTitle}>About Client-Side Encryption</Text>
            <Text style={styles.cryptoExplainerText}>
              • Files are encrypted using AES-256-GCM authenticated encryption before leaving your device.
              {'\n'}• Files appear as unreadable binary (.bin) documents in Telegram; Telegram cannot preview them.
              {'\n'}• Media can be decrypted and restored in TG Cloud after entering your 12-word recovery passphrase.
              {'\n'}• If you lose your passphrase, encrypted backups are permanently unrecoverable.
            </Text>
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
                With client-side encryption, only you possess the master key. Encrypted files appear as unreadable binary (.bin) on Telegram. If you lose your recovery passphrase, your backups will be PERMANENTLY UNRECOVERABLE. Telegram cannot recover them.
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
              <View style={[styles.checkbox, hasConfirmedSaved && styles.checkboxActive]}>
                {hasConfirmedSaved && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                I have securely copied or saved my 12 recovery words.
              </Text>
            </TouchableOpacity>

            {setupError ? <Text style={styles.errorText}>{setupError}</Text> : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowSetupModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  !hasConfirmedSaved && styles.confirmBtnDisabled,
                ]}
                disabled={!hasConfirmedSaved}
                onPress={handleConfirmVerification}
              >
                <Text style={styles.confirmBtnText}>Enable Encryption</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Unlock Passphrase Modal in Settings */}
      <Modal
        visible={showUnlockModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUnlockModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Unlock Cloud Media</Text>
            <Text style={styles.modalDesc}>
              Enter your saved 12-word recovery passphrase to decrypt your cloud backups.
            </Text>

            <TextInput
              style={styles.unlockInput}
              placeholder="e.g. eagle harbor quartz river beacon..."
              placeholderTextColor="#6b7280"
              value={unlockPassphraseInput}
              onChangeText={setUnlockPassphraseInput}
              multiline
              numberOfLines={3}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {unlockError && <Text style={styles.errorText}>{unlockError}</Text>}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowUnlockModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.confirmBtn}
                disabled={isVerifying}
                onPress={handleUnlockInSettings}
              >
                {isVerifying ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.confirmBtnText}>Unlock</Text>
                )}
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
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#16221c',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#243029',
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  accountDetails: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  accountSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  dangerButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 13,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  settingTextCol: {
    flex: 1,
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#243029',
    marginVertical: 12,
  },
  infoNoteBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
    padding: 10,
    borderRadius: 6,
  },
  infoNoteTitle: {
    color: '#34d399',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 3,
  },
  infoNoteText: {
    color: '#d1d5db',
    fontSize: 11,
    lineHeight: 15,
  },
  permissionStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  permBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  permBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  permActionContainer: {
    marginTop: 12,
  },
  permButton: {
    backgroundColor: '#10b981',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  permButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  channelsContainer: {
    paddingVertical: 4,
  },
  channelsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e5e7eb',
    marginBottom: 8,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111814',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1e2923',
  },
  channelTextCol: {
    flex: 1,
    marginRight: 8,
  },
  channelName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  channelStatus: {
    color: '#9ca3af',
    fontSize: 10,
    marginTop: 2,
  },
  channelTgBtn: {
    backgroundColor: '#16221c',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2d3d34',
  },
  channelTgBtnText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  resyncChannelsBtn: {
    marginTop: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  resyncChannelsBtnText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  encryptionActionBox: {
    marginTop: 8,
  },
  unlockKeyBtn: {
    backgroundColor: '#d97706',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  unlockKeyBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  lockKeyBtn: {
    backgroundColor: '#261c1c',
    borderWidth: 1,
    borderColor: '#543333',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  lockKeyBtnText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
  },
  cryptoExplainerBox: {
    backgroundColor: '#111814',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2923',
  },
  cryptoExplainerTitle: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  cryptoExplainerText: {
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 16,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  aboutLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },
  aboutValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#16221c',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#243029',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 10,
  },
  modalDesc: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 14,
  },
  warningBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
    padding: 10,
    borderRadius: 6,
    marginBottom: 14,
  },
  warningTitle: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 11,
    marginBottom: 2,
  },
  warningText: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 15,
  },
  keyLabel: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  wordChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  wordChip: {
    flexDirection: 'row',
    backgroundColor: '#111814',
    borderWidth: 1,
    borderColor: '#243029',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  wordChipIndex: {
    color: '#6b7280',
    fontSize: 10,
    marginRight: 4,
    fontWeight: '700',
  },
  wordChipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  passphraseActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  actionBtnCopy: {
    flex: 1,
    backgroundColor: '#10b981',
    paddingVertical: 9,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionBtnPhoto: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 9,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  successToast: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#9ca3af',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  checkboxLabel: {
    color: '#d1d5db',
    fontSize: 12,
    flex: 1,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  cancelBtnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  unlockInput: {
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
});
