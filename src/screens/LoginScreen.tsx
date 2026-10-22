import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { TelegramBridgeService } from '../native/TelegramBridge';
import { TelegramAuthState } from '../types/telegram';

interface LoginScreenProps {
  onLoginSuccess: (user: { userId: number; firstName: string; lastName: string }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [authCode, setAuthCode] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [authState, setAuthState] = useState<TelegramAuthState>({
    state: 'UNINITIALIZED',
  });

  useEffect(() => {
    // 1. Initial auth state check and auto-initialization
    let isMounted = true;

    const initAuth = async () => {
      try {
        setLoading(true);
        // Ensure TDLib is initialized with standard client credentials
        await TelegramBridgeService.initialize();
        const current = await TelegramBridgeService.getAuthState();
        if (isMounted) {
          setAuthState(current);
          if (current.state === 'READY') {
            onLoginSuccess({
              userId: current.userId ?? 0,
              firstName: current.firstName ?? '',
              lastName: current.lastName ?? '',
            });
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage(err.message || 'Failed to initialize Telegram service.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // 2. Listen to real-time auth updates from TDLib
    const unsubscribe = TelegramBridgeService.subscribeToAuthState(state => {
      if (!isMounted) return;
      setAuthState(state);
      setLoading(false);
      setErrorMessage('');

      if (state.state === 'READY') {
        onLoginSuccess({
          userId: state.userId ?? 0,
          firstName: state.firstName ?? '',
          lastName: state.lastName ?? '',
        });
      } else if (state.state === 'ERROR') {
        setErrorMessage(state.message || 'Telegram error occurred');
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [onLoginSuccess]);

  const handleSendPhone = async () => {
    const formatted = phoneNumber.trim().replace(/\s+/g, '');
    if (!formatted || formatted.length < 5) {
      setErrorMessage('Please enter a valid phone number with country code (e.g. +1 555 123 4567)');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await TelegramBridgeService.sendPhoneNumber(formatted);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit phone number. Please try again.');
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    const cleanCode = authCode.trim();
    if (!cleanCode) {
      setErrorMessage('Please enter the verification code you received');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await TelegramBridgeService.sendAuthCode(cleanCode);
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid verification code. Please check and try again.');
      setLoading(false);
    }
  };

  const handleSendPassword = async () => {
    if (!password) {
      setErrorMessage('Please enter your 2-Step Verification password');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await TelegramBridgeService.sendPassword(password);
    } catch (err: any) {
      setErrorMessage(err.message || 'Incorrect 2-step verification password.');
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    setLoading(true);
    setErrorMessage('');
    setAuthCode('');
    setPassword('');
    try {
      await TelegramBridgeService.logOut();
    } catch {
      // Ignored if already logging out
    } finally {
      setLoading(false);
    }
  };

  const isWaitCode = authState.state === 'WAIT_CODE';
  const isWaitPassword = authState.state === 'WAIT_PASSWORD';
  const isWaitPhone =
    authState.state === 'WAIT_PHONE_NUMBER' ||
    authState.state === 'UNINITIALIZED' ||
    authState.state === 'WAIT_PARAMETERS';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand Header */}
        <View style={styles.brandHeader}>
          <View style={styles.iconCircle}>
            <Text style={styles.brandIcon}>☁️</Text>
          </View>
          <Text style={styles.brandTitle}>TG Cloud</Text>
          <Text style={styles.brandSubtitle}>
            Infinite, Private & Encrypted Gallery Backup
          </Text>
        </View>

        {/* Auth Card */}
        <View style={styles.card}>
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
            </View>
          ) : null}

          {/* STEP 1: Phone Number Input */}
          {isWaitPhone && (
            <View>
              <Text style={styles.stepTitle}>Log in to Telegram</Text>
              <Text style={styles.stepDesc}>
                Enter your mobile number with country code. A verification code will be sent to your Telegram app or via SMS.
              </Text>

              <Text style={styles.inputLabel}>Phone Number</Text>
              <TextInput
                style={styles.input}
                placeholder="+1 234 567 8900"
                placeholderTextColor="#4b5563"
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                editable={!loading}
              />

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleSendPhone}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0a0f0d" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send Verification Code →</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 2: Verification Code Input */}
          {isWaitCode && (
            <View>
              <Text style={styles.stepTitle}>Enter Verification Code</Text>
              <Text style={styles.stepDesc}>
                We sent a login code to your Telegram app or SMS for{' '}
                <Text style={styles.highlightText}>{phoneNumber}</Text>.
              </Text>

              <Text style={styles.inputLabel}>Login Code</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="12345"
                placeholderTextColor="#4b5563"
                keyboardType="number-pad"
                autoFocus={true}
                value={authCode}
                onChangeText={setAuthCode}
                editable={!loading}
                maxLength={8}
              />

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleSendCode}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0a0f0d" />
                ) : (
                  <Text style={styles.primaryButtonText}>Verify & Log In</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleRestart}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>← Change Phone Number</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 3: 2FA Password Input */}
          {isWaitPassword && (
            <View>
              <Text style={styles.stepTitle}>Two-Step Verification</Text>
              <Text style={styles.stepDesc}>
                Your Telegram account is protected by an additional cloud password.
                {(authState as any).hint ? `\nHint: ${(authState as any).hint}` : ''}
              </Text>

              <Text style={styles.inputLabel}>Telegram Cloud Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter password"
                placeholderTextColor="#4b5563"
                secureTextEntry={true}
                autoFocus={true}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
              />

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleSendPassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0a0f0d" />
                ) : (
                  <Text style={styles.primaryButtonText}>Submit Password</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleRestart}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>← Start Over</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Security & Privacy Guarantee */}
        <View style={styles.privacyGuarantee}>
          <Text style={styles.privacyBadge}>🔒 Standalone Client-Side MTProto</Text>
          <Text style={styles.privacyNote}>
            Direct end-to-end connection to Telegram data centers via TDLib. Your credentials and media are never routed through any third-party developer server.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#16221c',
    borderWidth: 1,
    borderColor: '#243029',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brandIcon: {
    fontSize: 34,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f9fafb',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#121a15',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#243029',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f3f4f6',
    marginBottom: 8,
  },
  stepDesc: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    marginBottom: 20,
  },
  highlightText: {
    color: '#34d399',
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#d1d5db',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0a0f0d',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#f9fafb',
    marginBottom: 20,
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#34d399',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#0a0f0d',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '500',
  },
  privacyGuarantee: {
    marginTop: 32,
    alignItems: 'center',
  },
  privacyBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
    backgroundColor: '#16221c',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  privacyNote: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 12,
  },
});
