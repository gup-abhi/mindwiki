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

import { useAuth, type AuthMode } from '@/hooks/useAuth'

/**
 * Account-first gate shown when there's no session. Register creates an account
 * (email optional) and escrows the master key; Login recovers it on a known
 * device. On success the auth store flips to 'authenticated' and the app mounts.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { submit, submitting, error } = useAuth()

  const isRegister = mode === 'register'
  const canSubmit =
    password.length >= 8 && (isRegister || email.trim().length > 0) && !submitting

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
          placeholder={isRegister ? 'Email (optional)' : 'Email'}
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          testID="auth-email"
        />
        <TextInput
          style={styles.input}
          placeholder="Password (8+ characters)"
          placeholderTextColor="#999"
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
          testID="auth-password"
        />

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
})
