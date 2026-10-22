import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';

export interface UserProfileInfo {
  userId: number;
  firstName: string;
  lastName: string;
}

interface ProfileScreenProps {
  user: UserProfileInfo | null;
  onLogout: () => void;
  onNavigateToSettings?: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  user,
  onLogout,
  onNavigateToSettings,
}) => {
  const displayName = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ') || 'Telegram User';

  const initials = (
    (user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')
  ).toUpperCase() || 'TG';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Account Avatar Card */}
      <View style={styles.card}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <Text style={styles.userName}>{displayName}</Text>
        <Text style={styles.userId}>User ID: {user?.userId || 'Connected'}</Text>
        <View style={styles.statusBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusBadgeText}>Connected to Telegram</Text>
        </View>
      </View>

      {/* Account Details & Operational Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>First Name</Text>
          <Text style={styles.infoValue}>{user?.firstName || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Name</Text>
          <Text style={styles.infoValue}>{user?.lastName || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Telegram ID</Text>
          <Text style={styles.infoValue}>{user?.userId ? String(user.userId) : '—'}</Text>
        </View>
        <View style={[styles.infoRow, styles.lastRow]}>
          <Text style={styles.infoLabel}>Cloud Storage</Text>
          <Text style={styles.infoValue}>Private Channels</Text>
        </View>
      </View>

      {/* Quick Settings Shortcut */}
      {onNavigateToSettings ? (
        <TouchableOpacity style={styles.settingsButton} onPress={onNavigateToSettings}>
          <Text style={styles.settingsButtonText}>⚙️ Open Backup & App Settings</Text>
        </TouchableOpacity>
      ) : null}

      {/* Logout Action */}
      <View style={styles.logoutContainer}>
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutButtonText}>Log Out of Telegram</Text>
        </TouchableOpacity>
        <Text style={styles.logoutNote}>
          Logging out removes your session from this device. Your backed-up photos and videos remain safely in your private Telegram cloud channels.
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
  card: {
    backgroundColor: '#121a15',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#243029',
    marginBottom: 24,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1b3327',
    borderWidth: 2,
    borderColor: '#34d399',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#34d399',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f9fafb',
    marginBottom: 4,
  },
  userId: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16221c',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#243029',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#121a15',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#243029',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c2820',
  },
  lastRow: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  infoLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f3f4f6',
  },
  settingsButton: {
    backgroundColor: '#16221c',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 24,
  },
  settingsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  logoutContainer: {
    marginTop: 8,
  },
  logoutButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#f87171',
    fontSize: 15,
    fontWeight: '700',
  },
  logoutNote: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 16,
    paddingHorizontal: 8,
  },
});
