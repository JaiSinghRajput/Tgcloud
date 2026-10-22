import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
} from 'react-native';
import { NetworkPolicy } from '../domain/backup/stateMachine';

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>CONFIGURATION</Text>
        <Text style={styles.headerTitle}>Settings & Policies</Text>
        <Text style={styles.headerDesc}>
          Manage background network transfer constraints, deletion safety rules,
          and encryption.
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

      {/* Client-Side Encryption */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Client-Side Encryption (Phase 7)</Text>
        <Text style={styles.cardDesc}>
          Optionally encrypt media and thumbnails with AES-256-GCM before
          uploading to Telegram.
        </Text>

        <View style={styles.settingRow}>
          <View style={styles.settingTextCol}>
            <Text style={styles.settingTitle}>
              Enable Client-Side Encryption
            </Text>
            <Text style={styles.settingSubtitle}>
              {encryptionEnabled
                ? 'Client-side AES-256-GCM encryption is armed'
                : 'Media is backed up in private Telegram channels with standard MTProto transport'}
            </Text>
          </View>
          <Switch
            value={encryptionEnabled}
            onValueChange={onToggleEncryption}
            trackColor={{ false: '#374151', true: '#047857' }}
            thumbColor={encryptionEnabled ? '#10b981' : '#9ca3af'}
          />
        </View>
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
});
