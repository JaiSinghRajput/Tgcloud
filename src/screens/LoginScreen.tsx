import React, { useState, useEffect, useRef } from 'react';
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
  // Country Code Separation State
  const [countryCode, setCountryCode] = useState<string>('+1');
  const [nationalPhone, setNationalPhone] = useState<string>('');

  // OTP 5-Box State
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '']);
  const [focusedOtpIndex, setFocusedOtpIndex] = useState<number>(0);
  const otpInputRefs = useRef<Array<any>>([]);

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
    let cleanCode = countryCode.trim();
    if (!cleanCode.startsWith('+')) {
      cleanCode = '+' + cleanCode;
    }
    const cleanNumber = nationalPhone.trim().replace(/\D/g, '');

    if (cleanCode.length < 2) {
      setErrorMessage('Please enter a valid country code (e.g. +1 or +91)');
      return;
    }

    if (!cleanNumber || cleanNumber.length < 4) {
      setErrorMessage('Please enter a valid phone number');
      return;
    }

    const fullPhoneNumber = `${cleanCode}${cleanNumber}`;

    setLoading(true);
    setErrorMessage('');
    try {
      await TelegramBridgeService.sendPhoneNumber(fullPhoneNumber);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit phone number. Please try again.');
      setLoading(false);
    }
  };

  const submitOtpCode = async (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length < 5) {
      setErrorMessage('Please enter all 5 digits of the verification code');
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

  const handleOtpDigitChange = (value: string, index: number) => {
    // Check if user pasted a multi-digit code (e.g. 5 digits pasted)
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length > 1) {
      const newDigits = [...otpDigits];
      for (let i = 0; i < 5; i++) {
        newDigits[i] = cleaned[i] || '';
      }
      setOtpDigits(newDigits);
      const lastIndex = Math.min(cleaned.length - 1, 4);
      otpInputRefs.current[lastIndex]?.focus();

      if (cleaned.length >= 5) {
        submitOtpCode(newDigits.slice(0, 5).join(''));
      }
      return;
    }

    const newDigits = [...otpDigits];
    newDigits[index] = cleaned;
    setOtpDigits(newDigits);

    // Auto-advance to next box if a digit was entered
    if (cleaned.length === 1 && index < 4) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if all 5 digits are completed
    const fullCode = newDigits.join('');
    if (fullCode.length === 5) {
      submitOtpCode(fullCode);
    }
  };

  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace') {
      if (otpDigits[index] === '' && index > 0) {
        const newDigits = [...otpDigits];
        newDigits[index - 1] = '';
        setOtpDigits(newDigits);
        otpInputRefs.current[index - 1]?.focus();
      }
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
    setOtpDigits(['', '', '', '', '']);
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

  const fullPhoneDisplay = `${countryCode} ${nationalPhone}`.trim();

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

          {/* STEP 1: Phone Number Input with Country Code Separation */}
          {isWaitPhone && (
            <View>
              <Text style={styles.stepTitle}>Log in to Telegram</Text>
              <Text style={styles.stepDesc}>
                Enter your mobile number. A verification code will be sent to your Telegram app or via SMS.
              </Text>

              <Text style={styles.inputLabel}>Mobile Phone Number</Text>
              <View style={styles.phoneInputRow}>
                {/* Separated Country Code Box */}
                <View style={styles.countryCodeBox}>
                  <TextInput
                    style={styles.countryCodeInput}
                    value={countryCode}
                    onChangeText={text => {
                      let code = text.trim();
                      if (code.length > 0 && !code.startsWith('+')) {
                        code = '+' + code;
                      }
                      setCountryCode(code);
                    }}
                    placeholder="+1"
                    placeholderTextColor="#6b7280"
                    keyboardType="phone-pad"
                    maxLength={5}
                    editable={!loading}
                    accessibilityLabel="Country Code"
                  />
                </View>

                {/* Separated National Phone Number Box */}
                <View style={styles.nationalPhoneBox}>
                  <TextInput
                    style={styles.nationalPhoneInput}
                    placeholder="98765 43210"
                    placeholderTextColor="#4b5563"
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={nationalPhone}
                    onChangeText={setNationalPhone}
                    editable={!loading}
                    accessibilityLabel="Phone Number"
                  />
                </View>
              </View>

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

          {/* STEP 2: Separated 5-Digit OTP Verification Boxes */}
          {isWaitCode && (
            <View>
              <Text style={styles.stepTitle}>Enter Verification Code</Text>
              <Text style={styles.stepDesc}>
                We sent a 5-digit login code to your Telegram app or SMS for{' '}
                <Text style={styles.highlightText}>{fullPhoneDisplay}</Text>.
              </Text>

              <Text style={styles.inputLabel}>5-Digit OTP Code</Text>
              <View style={styles.otpContainer}>
                {otpDigits.map((digit, idx) => {
                  const isFocused = focusedOtpIndex === idx;
                  const isFilled = digit.length > 0;
                  return (
                    <View
                      key={idx}
                      style={[
                        styles.otpBox,
                        isFocused && styles.otpBoxFocused,
                        isFilled && styles.otpBoxFilled,
                      ]}
                    >
                      <TextInput
                        ref={ref => {
                          otpInputRefs.current[idx] = ref;
                        }}
                        style={styles.otpDigitInput}
                        keyboardType="number-pad"
                        maxLength={5} // Allows paste of full code
                        value={digit}
                        onFocus={() => setFocusedOtpIndex(idx)}
                        onChangeText={val => handleOtpDigitChange(val, idx)}
                        onKeyPress={e => handleOtpKeyPress(e, idx)}
                        autoFocus={idx === 0}
                        editable={!loading}
                        selectTextOnFocus={true}
                        textAlign="center"
                      />
                    </View>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={() => submitOtpCode(otpDigits.join(''))}
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
            Direct end-to-end connection to Telegram data centers via TDLib. Your credentials and media are never routed through any third-party server.
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
  phoneInputRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  countryCodeBox: {
    width: 76,
    marginRight: 10,
    backgroundColor: '#0a0f0d',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
  },
  countryCodeInput: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  nationalPhoneBox: {
    flex: 1,
    backgroundColor: '#0a0f0d',
    borderColor: '#243029',
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
  },
  nationalPhoneInput: {
    color: '#f9fafb',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  otpBox: {
    width: 52,
    height: 60,
    backgroundColor: '#0a0f0d',
    borderColor: '#243029',
    borderWidth: 1.5,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxFocused: {
    borderColor: '#34d399',
    backgroundColor: '#162b20',
  },
  otpBoxFilled: {
    borderColor: '#10b981',
  },
  otpDigitInput: {
    width: '100%',
    height: '100%',
    color: '#f9fafb',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
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
