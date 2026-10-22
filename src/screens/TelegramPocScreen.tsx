import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { TelegramBridgeService } from '../native/TelegramBridge';
import {
  TelegramAuthState,
  TelegramBackupChannels,
  PocSuiteResult,
} from '../types/telegram';

export const TelegramPocScreen: React.FC = () => {
  const [apiId, setApiId] = useState<string>('');
  const [apiHash, setApiHash] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [authCode, setAuthCode] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  const [authState, setAuthState] = useState<TelegramAuthState>({
    state: 'UNINITIALIZED',
  });
  const [channels, setChannels] = useState<TelegramBackupChannels | null>(null);
  const [pocResult, setPocResult] = useState<PocSuiteResult | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    // Initial auth state check
    TelegramBridgeService.getAuthState()
      .then(state => setAuthState(state))
      .catch(err =>
        setStatusMessage(`Error reading auth state: ${err.message}`),
      );

    // Listen to real-time auth updates
    const unsubscribe = TelegramBridgeService.subscribeToAuthState(state => {
      setAuthState(state);
      if (state.state === 'READY') {
        setStatusMessage(
          `Connected as ${state.firstName} (User ID: ${state.userId})`,
        );
      }
    });

    return () => unsubscribe();
  }, []);

  const handleInitialize = async () => {
    const id = parseInt(apiId.trim(), 10);
    const hash = apiHash.trim();
    if (!id || !hash) {
      setStatusMessage('Please enter both Telegram API ID and API Hash');
      return;
    }
    setLoading(true);
    try {
      await TelegramBridgeService.initialize(id, hash);
      setStatusMessage(
        'TDLib initialized. Awaiting authentication parameters...',
      );
    } catch (err: any) {
      setStatusMessage(`Initialization error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhone = async () => {
    if (!phoneNumber.trim()) {
      setStatusMessage('Please enter phone number');
      return;
    }
    setLoading(true);
    try {
      await TelegramBridgeService.sendPhoneNumber(phoneNumber.trim());
      setStatusMessage(
        'Verification code requested. Check your Telegram app or SMS.',
      );
    } catch (err: any) {
      setStatusMessage(`Phone error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!authCode.trim()) {
      setStatusMessage('Please enter the received code');
      return;
    }
    setLoading(true);
    try {
      await TelegramBridgeService.sendAuthCode(authCode.trim());
      setStatusMessage('Verifying authentication code...');
    } catch (err: any) {
      setStatusMessage(`Code error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendPassword = async () => {
    if (!password.trim()) {
      setStatusMessage('Please enter your 2FA password');
      return;
    }
    setLoading(true);
    try {
      await TelegramBridgeService.sendPassword(password.trim());
      setStatusMessage('Verifying cloud password...');
    } catch (err: any) {
      setStatusMessage(`Password error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSetupChannels = async () => {
    setLoading(true);
    try {
      const res = await TelegramBridgeService.setupChannels();
      setChannels(res);
      setStatusMessage('Photo & Video private backup channels verified!');
    } catch (err: any) {
      setStatusMessage(`Channel setup error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunPoc = async () => {
    setLoading(true);
    setPocResult(null);
    setStatusMessage(
      'Running Phase 1 10-step TDLib proof-of-concept validation suite...',
    );
    try {
      const result = await TelegramBridgeService.runPocTest();
      setPocResult(result);
      if (result.success) {
        setStatusMessage(
          'Proof of Concept PASSED: All 10 validation steps succeeded!',
        );
      } else {
        setStatusMessage(
          `Proof of Concept: ${result.passedSteps}/${result.totalSteps} steps completed`,
        );
      }
    } catch (err: any) {
      setStatusMessage(`PoC suite failure: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogOut = async () => {
    setLoading(true);
    try {
      await TelegramBridgeService.logOut();
      setChannels(null);
      setPocResult(null);
      setStatusMessage('Logged out from Telegram.');
    } catch (err: any) {
      setStatusMessage(`Logout error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.badgeRow}>
            <View style={styles.statusDot} />
            <Text style={styles.headerSubtitle}>
              PHASE 1 · TDLIB PROOF OF CONCEPT
            </Text>
          </View>
          <Text style={styles.headerTitle}>Telegram Integration</Text>
          <Text style={styles.headerDesc}>
            Direct native TDLib MTProto client without intermediate developer
            backend.
          </Text>
        </View>

        {/* Status notification banner */}
        {statusMessage ? (
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>{statusMessage}</Text>
          </View>
        ) : null}

        {/* Section 1: Telegram API Credentials */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Telegram Client Credentials</Text>
          <Text style={styles.cardDesc}>
            From my.telegram.org. App-private storage only; never transmitted
            off-device.
          </Text>

          <Text style={styles.inputLabel}>API ID</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 12345678"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
            value={apiId}
            onChangeText={setApiId}
          />

          <Text style={styles.inputLabel}>API Hash</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 0123456789abcdef0123456789abcdef"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            secureTextEntry
            value={apiHash}
            onChangeText={setApiHash}
          />

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleInitialize}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Initialize TDLib Client</Text>
          </TouchableOpacity>
        </View>

        {/* Section 2: Authorization State Machine */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>2. Authorization State</Text>
            <View style={styles.stateTag}>
              <Text style={styles.stateTagText}>{authState.state}</Text>
            </View>
          </View>

          {authState.state === 'WAIT_PHONE_NUMBER' && (
            <View style={styles.authSection}>
              <Text style={styles.inputLabel}>
                Phone Number (International format)
              </Text>
              <TextInput
                style={styles.input}
                placeholder="+1234567890"
                placeholderTextColor="#6b7280"
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSendPhone}
                disabled={loading}
              >
                <Text style={styles.buttonText}>Submit Phone Number</Text>
              </TouchableOpacity>
            </View>
          )}

          {authState.state === 'WAIT_CODE' && (
            <View style={styles.authSection}>
              <Text style={styles.inputLabel}>Verification Code</Text>
              <TextInput
                style={styles.input}
                placeholder="5-digit code"
                placeholderTextColor="#6b7280"
                keyboardType="numeric"
                value={authCode}
                onChangeText={setAuthCode}
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSendCode}
                disabled={loading}
              >
                <Text style={styles.buttonText}>Verify Code</Text>
              </TouchableOpacity>
            </View>
          )}

          {authState.state === 'WAIT_PASSWORD' && (
            <View style={styles.authSection}>
              <Text style={styles.inputLabel}>Two-Factor Password (2FA)</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter 2FA password"
                placeholderTextColor="#6b7280"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSendPassword}
                disabled={loading}
              >
                <Text style={styles.buttonText}>Submit Password</Text>
              </TouchableOpacity>
            </View>
          )}

          {authState.state === 'READY' && (
            <View style={styles.readyCard}>
              <Text style={styles.readyText}>
                Active Session: {authState.firstName} {authState.lastName} (ID:{' '}
                {authState.userId})
              </Text>
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogOut}
                disabled={loading}
              >
                <Text style={styles.logoutButtonText}>
                  Disconnect / Log Out
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Section 3: Channel Setup */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>3. Private Backup Channels</Text>
          <Text style={styles.cardDesc}>
            Organized into two private channels: one for photos, one for videos.
          </Text>

          {channels ? (
            <View style={styles.channelDetails}>
              <View style={styles.channelRow}>
                <Text style={styles.channelLabel}>Photos:</Text>
                <Text style={styles.channelValue}>
                  {channels.photoChannelTitle} ({channels.photoChannelId})
                </Text>
              </View>
              <View style={styles.channelRow}>
                <Text style={styles.channelLabel}>Videos:</Text>
                <Text style={styles.channelValue}>
                  {channels.videoChannelTitle} ({channels.videoChannelId})
                </Text>
              </View>
              <View style={styles.verifiedRow}>
                <Text style={styles.verifiedBadge}>
                  Verified Posting Access
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                authState.state !== 'READY' && styles.buttonDisabled,
              ]}
              onPress={handleSetupChannels}
              disabled={authState.state !== 'READY' || loading}
            >
              <Text style={styles.secondaryButtonText}>
                Create / Verify Backup Channels
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Section 4: Phase 1 PoC Validation Suite */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            4. Phase 1 Gate A — TDLib PoC Suite
          </Text>
          <Text style={styles.cardDesc}>
            Executes 10 automated validation steps: upload, metadata envelope,
            history pagination, idempotency reconciliation, download, and file
            checksum.
          </Text>

          <TouchableOpacity
            style={[
              styles.emeraldButton,
              authState.state !== 'READY' && styles.buttonDisabled,
            ]}
            onPress={handleRunPoc}
            disabled={authState.state !== 'READY' || loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.emeraldButtonText}>
                Run 10-Step PoC Test Suite
              </Text>
            )}
          </TouchableOpacity>

          {pocResult && (
            <View style={styles.pocResultsContainer}>
              <View style={styles.pocSummaryHeader}>
                <Text style={styles.pocSummaryTitle}>
                  Test Results: {pocResult.passedSteps} / {pocResult.totalSteps}{' '}
                  Passed
                </Text>
                <View
                  style={[
                    styles.resultBadge,
                    pocResult.success
                      ? styles.badgeSuccess
                      : styles.badgeFailed,
                  ]}
                >
                  <Text style={styles.resultBadgeText}>
                    {pocResult.success ? 'PASSED' : 'FAILED'}
                  </Text>
                </View>
              </View>

              {pocResult.steps.map(step => (
                <View key={step.step} style={styles.stepItem}>
                  <View style={styles.stepTopRow}>
                    <Text style={styles.stepNumber}>Step {step.step}</Text>
                    <Text style={styles.stepName}>{step.name}</Text>
                    <Text
                      style={[
                        styles.stepStatus,
                        step.passed ? styles.statusPass : styles.statusFail,
                      ]}
                    >
                      {step.passed ? 'PASS' : 'FAIL'} ({step.durationMs}ms)
                    </Text>
                  </View>
                  <Text style={styles.stepMessage}>{step.message}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
  },
  scrollContent: {
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
    backgroundColor: '#10b981',
  },
  headerSubtitle: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  headerTitle: {
    color: '#f3f4f6',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  headerDesc: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
  statusBanner: {
    backgroundColor: '#142a1f',
    borderColor: '#047857',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  statusBannerText: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#121815',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
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
  inputLabel: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#1a231f',
    borderColor: '#2e3d34',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#f3f4f6',
    fontSize: 14,
    marginBottom: 14,
  },
  primaryButton: {
    backgroundColor: '#047857',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryButton: {
    backgroundColor: '#1f2e26',
    borderColor: '#047857',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
  },
  emeraldButton: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emeraldButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  stateTag: {
    backgroundColor: '#1c2922',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  stateTagText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  authSection: {
    marginTop: 8,
  },
  readyCard: {
    backgroundColor: '#16281e',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  readyText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  logoutButton: {
    backgroundColor: '#374151',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '600',
  },
  channelDetails: {
    backgroundColor: '#16221c',
    borderRadius: 8,
    padding: 12,
  },
  channelRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  channelLabel: {
    color: '#9ca3af',
    width: 65,
    fontWeight: '600',
  },
  channelValue: {
    color: '#f3f4f6',
    flex: 1,
    fontWeight: '500',
  },
  verifiedRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopColor: '#243029',
    borderTopWidth: 1,
  },
  verifiedBadge: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 12,
  },
  pocResultsContainer: {
    marginTop: 18,
    borderTopColor: '#243029',
    borderTopWidth: 1,
    paddingTop: 16,
  },
  pocSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pocSummaryTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
  },
  resultBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeSuccess: {
    backgroundColor: '#065f46',
  },
  badgeFailed: {
    backgroundColor: '#7f1d1d',
  },
  resultBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  stepItem: {
    backgroundColor: '#16201b',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  stepTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  stepNumber: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 11,
    marginRight: 6,
  },
  stepName: {
    color: '#e5e7eb',
    fontWeight: '600',
    fontSize: 13,
    flex: 1,
  },
  stepStatus: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPass: {
    color: '#34d399',
  },
  statusFail: {
    color: '#f87171',
  },
  stepMessage: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
  },
});
