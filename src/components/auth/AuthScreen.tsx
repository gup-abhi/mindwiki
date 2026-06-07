import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { useAuth, type AuthMode } from '@/hooks/useAuth'

import { PairScanScreen } from './PairScanScreen'
import { RecoverScreen } from './RecoverScreen'
import { RecoveryPhraseView } from './RecoveryPhraseView'

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/**
 * Account-first gate shown when there's no session. Register creates an account
 * (email optional) and escrows the master key; Login recovers it on a known
 * device. On success the auth store flips to 'authenticated' and the app mounts.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('register')
  const [recovering, setRecovering] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { submit, submitting, error, pendingPhrase, confirmPhrase } = useAuth()

  // After a successful register, show the recovery phrase once before entering.
  if (pendingPhrase) return <RecoveryPhraseView phrase={pendingPhrase.phrase} onConfirm={confirmPhrase} />
  if (recovering) return <RecoverScreen onCancel={() => setRecovering(false)} />
  if (scanning) return <PairScanScreen onCancel={() => setScanning(false)} />

  const isRegister = mode === 'register'
  // Email is required for both flows: login looks the account up by email, and
  // it's the only way back into the escrow, so an email-less account is a lockout.
  const canSubmit = isValidEmail(email) && password.length >= 8 && !submitting

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.body}>
        <Text style={styles.title}>{isRegister ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>
          {isRegister
            ? 'Your journal stays encrypted on this device. An account only syncs it across your own devices.'
            : 'Sign in to restore your encrypted journal on this device.'}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          testID="auth-email"
        />
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="Password (8+ characters)"
            placeholderTextColor="#999"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            testID="auth-password"
          />
          <Pressable
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            testID="auth-password-toggle"
          >
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#999" />
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={() => submit(mode, email, password)}
          testID="auth-submit"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{isRegister ? 'Create account' : 'Sign in'}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => setMode(isRegister ? 'login' : 'register')}
          disabled={submitting}
          testID="auth-toggle"
        >
          <Text style={styles.toggle}>
            {isRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </Pressable>

        {!isRegister && (
          <Pressable onPress={() => setRecovering(true)} disabled={submitting} testID="auth-forgot">
            <Text style={styles.forgot}>Forgot password? Recover with your phrase</Text>
          </Pressable>
        )}

        <Pressable onPress={() => setScanning(true)} disabled={submitting} testID="auth-pair">
          <Text style={styles.forgot}>Pair with another device</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1, justifyContent: 'center', padding: 28 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 15, color: '#666', marginTop: 8, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: '#e6e6f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a2e',
    marginTop: 16,
  },
  passwordWrap: { marginTop: 16, justifyContent: 'center' },
  passwordInput: { marginTop: 0, paddingRight: 48 },
  eyeButton: { position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: '#d12f2f', fontSize: 14, marginTop: 12 },
  button: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: { backgroundColor: '#b9b9cc' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  toggle: { color: '#7a7ad0', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 22 },
  forgot: { color: '#7a7ad0', fontSize: 14, textAlign: 'center', marginTop: 16 },
})
