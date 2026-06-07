import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { useAuth } from '@/hooks/useAuth'

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/**
 * Forgot-password recovery: enter email + the 12-word recovery phrase + a new
 * password. Recovers the master key from the phrase escrow, sets the new
 * password, and enters the app. onCancel returns to the sign-in form.
 */
export function RecoverScreen({ onCancel }: { onCancel: () => void }) {
  const [email, setEmail] = useState('')
  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { recover, submitting, error } = useAuth()

  const canSubmit =
    isValidEmail(email) && phrase.trim().split(/\s+/).length === 12 && password.length >= 8 && !submitting

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Recover your account</Text>
        <Text style={styles.subtitle}>
          Enter your recovery phrase to restore your journal and set a new password.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          testID="recover-email"
        />
        <TextInput
          style={[styles.input, styles.phraseInput]}
          placeholder="12-word recovery phrase"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          value={phrase}
          onChangeText={setPhrase}
          testID="recover-phrase"
        />
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="New password (8+ characters)"
            placeholderTextColor="#999"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            testID="recover-password"
          />
          <Pressable
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            testID="recover-password-toggle"
          >
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#999" />
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={() => recover(email, phrase, password)}
          testID="recover-submit"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Recover account</Text>
          )}
        </Pressable>

        <Pressable onPress={onCancel} disabled={submitting} testID="recover-cancel">
          <Text style={styles.toggle}>Back to sign in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 28, paddingTop: 64 },
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
  phraseInput: { minHeight: 90, textAlignVertical: 'top' },
  passwordWrap: { marginTop: 16, justifyContent: 'center' },
  passwordInput: { marginTop: 0, paddingRight: 48 },
  eyeButton: { position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: '#d12f2f', fontSize: 14, marginTop: 12 },
  button: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { backgroundColor: '#b9b9cc' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  toggle: { color: '#7a7ad0', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 22 },
})
