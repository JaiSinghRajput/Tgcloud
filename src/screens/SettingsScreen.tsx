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
} from 'react-native';
import { NetworkPolicy } from '../domain/backup/stateMachine';
import {
  generateRecoveryKey,
  normalizeRecoveryKey,
} from '../domain/crypto/encryptionService';

interface SettingsScreenProps {
  networkPolicy: NetworkPolicy;
  requiresCharging: boolean;
  encryptionEnabled: boolean;
  onToggleNetworkPolicy: (wifiOnly: boolean) => void;
  onToggleCharging: (chargingOnly: boolean) => void;
  onToggleEncryption: (enabled: boolean) => void;
  onDisconnectTelegram: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  networkPolicy,
  requiresCharging,
  encryptionEnabled,
  onToggleNetworkPolicy,
  onToggleCharging,
  onToggleEncryption,
  onDisconnectTelegram,
}) => {
  const isWifiOnly = networkPolicy === NetworkPolicy.WIFI_ONLY;

  // Encryption setup modal state
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [confirmationInput, setConfirmationInput] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);

  const handleToggleEncryption = (newValue: boolean) => {
    if (newValue && !encryptionEnabled) {
      // Must generate and verify recovery key before enabling!
      const newKey = generateRecoveryKey();
      setGeneratedKey(newKey);
      setConfirmationInput('');
      setSetupError(null);
      setShowSetupModal(true);
    } else {
      onToggleEncryption(false);
    }
  };

  const handleConfirmVerification = () => {
    const normalizedInput = normalizeRecoveryKey(confirmationInput);
    const normalizedGen = normalizeRecoveryKey(generatedKey);

    if (normalizedInput !== normalizedGen) {
      setSetupError(
        'Recovery passphrase does not match. Please verify all 12 words carefully.',
      );
      return;
    }

    setSetupError(null);
    setShowSetupModal(false);
    onToggleEncryption(true);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>CONFIGURATION</Text>
        <Text style={styles.headerTitle}>Settings & Policies</Text>
        <Text style={styles.headerDesc}>
          Manage background network transfer constraints, deletion safety rules,
          and client-side encryption.
        </Text>
      </View>

      {/* Network Policy */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Network Transfer Policy</Text>
        <Text style={styles.cardDesc}>
          Configure network types permitted to perform background media
          transfers.
        </Text>

        <View style={styles.settingRow}>
          <View style={styles.settingTextCol}>
            <Text style={styles.settingTitle}>Wi-Fi Only Transfer</Text>
            <Text style={styles.settingSubtitle}>
              {isWifiOnly
                ? 'Backups will only execute on unmetered Wi-Fi connections'
                : 'Backups are allowed on both Wi-Fi and Cellular data'}
            </Text>
          </View>
          <Switch
            value={isWifiOnly}
            onValueChange={onToggleNetworkPolicy}
            trackColor={{ false: '#374151', true: '#047857' }}
            thumbColor={isWifiOnly ? '#10b981' : '#9ca3af'}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingTextCol}>
            <Text style={styles.settingTitle}>Charging Only Preference</Text>
            <Text style={styles.settingSubtitle}>
              Pause automated background transfers while on battery power
            </Text>
          </View>
          <Switch
            value={requiresCharging}
            onValueChange={onToggleCharging}
            trackColor={{ false: '#374151', true: '#047857' }}
            thumbColor={requiresCharging ? '#10b981' : '#9ca3af'}
          />
        </View>
      </View>

      {/* Deletion Safety Policy */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Deletion Safety Policy</Text>
        <View style={styles.policyNotice}>
          <Text style={styles.policyNoticeBadge}>
            ACTIVE RULE (DECISIONS.md)
          </Text>
          <Text style={styles.policyNoticeTitle}>
            Local deletion preserves cloud copies
          </Text>
          <Text style={styles.policyNoticeDesc}>
            Deleting a photo or video from your device gallery does NOT delete
            the backup in your Telegram channels. Telegram copies are retained
            safely until explicitly removed.
          </Text>
        </View>
      </View>

      {/* Client-Side Encryption (Phase 7 - Gate E) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Client-Side Encryption (Gate E)</Text>
        <Text style={styles.cardDesc}>
          Zero-knowledge authenticated encryption using AES-256-GCM and
          PBKDF2-HMAC-SHA256. Sensitive filenames, relative paths, and content
          hashes are strictly concealed.
        </Text>

        <View style={styles.settingRow}>
          <View style={styles.settingTextCol}>
            <Text style={styles.settingTitle}>
              Enable Client-Side Encryption
            </Text>
            <Text style={styles.settingSubtitle}>
              {encryptionEnabled
                ? 'AES-256-GCM encryption is ACTIVE & verified'
                : 'Media is backed up in private Telegram channels with standard MTProto transport'}
            </Text>
          </View>
          <Switch
            value={encryptionEnabled}
            onValueChange={handleToggleEncryption}
            trackColor={{ false: '#374151', true: '#047857' }}
            thumbColor={encryptionEnabled ? '#10b981' : '#9ca3af'}
          />
        </View>

        {encryptionEnabled && (
          <View style={styles.activeEncryptionBanner}>
            <Text style={styles.activeEncryptionBadge}>ARMED</Text>
            <Text style={styles.activeEncryptionText}>
              Per-item random 256-bit DEKs and 96-bit nonces protect all
              uploaded media. No plaintext metadata is exposed in message
              captions.
            </Text>
          </View>
        )}
      </View>

      {/* Telegram Session */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Telegram Session & Storage</Text>
        <Text style={styles.cardDesc}>
          Credentials and TDLib state are isolated strictly inside app-private
          sandboxed storage.
        </Text>

        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={onDisconnectTelegram}
        >
          <Text style={styles.disconnectButtonText}>
            Disconnect Telegram Account
          </Text>
        </TouchableOpacity>
      </View>

      {/* Build Info */}
      <View style={styles.footerInfo}>
        <Text style={styles.footerInfoText}>
          Telegram Gallery Backup v0.0.1
        </Text>
        <Text style={styles.footerInfoText}>
          TDLib 1.8.x · Kotlin 2.2 · RN 0.88
        </Text>
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
                Private Telegram channels are NOT end-to-end encrypted storage.
                With client-side encryption, only you possess the master key. If
                you lose your recovery passphrase, your backups will be
                PERMANENTLY UNRECOVERABLE. Telegram cannot recover them.
              </Text>
            </View>

            <Text style={styles.keyLabel}>
              Your 12-Word Recovery Passphrase:
            </Text>
            <View style={styles.keyBox}>
              <Text style={styles.keyText}>{generatedKey}</Text>
            </View>

            <Text style={styles.instructionText}>
              Write down or save these 12 words in a secure location. To verify
              you have saved them, type or paste the words below:
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Enter your 12 recovery words..."
              placeholderTextColor="#6b7280"
              value={confirmationInput}
              onChangeText={setConfirmationInput}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />

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
                <Text style={styles.confirmButtonText}>Verify & Enable</Text>
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
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
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
  card: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardDesc: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingTextCol: {
    flex: 1,
    marginRight: 14,
  },
  settingTitle: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '600',
  },
  settingSubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#1f2e26',
    marginVertical: 14,
  },
  policyNotice: {
    backgroundColor: '#16281e',
    borderColor: '#047857',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
  },
  policyNoticeBadge: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  policyNoticeTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  policyNoticeDesc: {
    color: '#d1d5db',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  activeEncryptionBanner: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
  },
  activeEncryptionBadge: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  },
  activeEncryptionText: {
    color: '#d1fae5',
    fontSize: 12,
    lineHeight: 16,
  },
  disconnectButton: {
    backgroundColor: '#374151',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  disconnectButtonText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '700',
  },
  footerInfo: {
    alignItems: 'center',
    marginTop: 10,
  },
  footerInfoText: {
    color: '#4b5563',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 480,
  },
  modalTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  warningBox: {
    backgroundColor: '#451a03',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  warningTitle: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  warningText: {
    color: '#fef3c7',
    fontSize: 12,
    lineHeight: 16,
  },
  keyLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  keyBox: {
    backgroundColor: '#0a0f0d',
    borderColor: '#10b981',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  keyText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  instructionText: {
    color: '#d1d5db',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1b2420',
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: '#f9fafb',
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 10,
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
