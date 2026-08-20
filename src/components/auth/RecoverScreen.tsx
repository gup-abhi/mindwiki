import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { Button, Text, TextField } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useAuth } from '@/hooks/useAuth'
import { isValidRecoveryPhrase } from '@/services/auth/recovery'

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/**
 * Forgot-password recovery: enter email + the 12-word recovery phrase + a new
 * password. Recovers the master key from the phrase escrow, sets the new
 * password, and enters the app. onCancel returns to the sign-in form.
 */
export function RecoverScreen({ onCancel }: { onCancel: () => void }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const { recover, submitting, error } = useAuth()

  const validPhrase = isValidRecoveryPhrase(phrase)
  const passwordsMatch = password === confirmPassword
  const canSubmit =
    isValidEmail(email) && validPhrase && password.length >= 8 && passwordsMatch && !submitting

  const showInvalidPhrase = phrase.trim().length > 0 && !validPhrase
  const showPasswordMismatch = confirmPassword.length > 0 && !passwordsMatch

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style={theme.statusBar} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="title">Recover your account</Text>
        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          Enter your recovery phrase to restore your journal and set a new password.
        </Text>

        <TextField
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          testID="recover-email"
          style={styles.input}
        />
        <TextField
          style={[styles.input, styles.phraseInput]}
          placeholder="12-word recovery phrase"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="noExcludeDescendants"
          multiline
          sensitive
          value={phrase}
          onChangeText={setPhrase}
          testID="recover-phrase"
        />
        <View style={styles.passwordWrap}>
          <TextField
            style={[styles.input, styles.passwordInput]}
            placeholder="New password (8+ characters)"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
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
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={theme.colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.passwordWrap}>
          <TextField
            style={[styles.input, styles.passwordInput]}
            placeholder="Confirm new password"
            secureTextEntry={!showConfirmPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            testID="recover-password-confirm"
          />
          <Pressable
            style={styles.eyeButton}
            onPress={() => setShowConfirmPassword((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
            testID="recover-password-confirm-toggle"
          >
            <Ionicons
              name={showConfirmPassword ? 'eye-off' : 'eye'}
              size={22}
              color={theme.colors.textMuted}
            />
          </Pressable>
        </View>

        {showInvalidPhrase && (
          <Text variant="caption" color="danger" style={styles.error}>
            Enter a valid recovery phrase.
          </Text>
        )}
        {showPasswordMismatch && (
          <Text variant="caption" color="danger" style={styles.error}>
            Passwords don’t match.
          </Text>
        )}

        {error && (
          <Text variant="caption" color="danger" style={styles.error}>
            {error}
          </Text>
        )}

        <View style={styles.submit}>
          <Button
            title="Recover account"
            loading={submitting}
            disabled={!canSubmit}
            fullWidth
            onPress={() => recover(email, phrase, password)}
            testID="recover-submit"
          />
        </View>

        <Pressable onPress={onCancel} disabled={submitting} testID="recover-cancel">
          <Text variant="label" color="accent" style={styles.toggle}>
            Back to sign in
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.bg },
    body: { padding: t.spacing['2xl'], paddingTop: t.spacing['3xl'] },
    subtitle: { marginTop: t.spacing.sm },
    input: { marginTop: t.spacing.lg },
    phraseInput: { minHeight: 90, textAlignVertical: 'top' },
    passwordWrap: { marginTop: t.spacing.lg, justifyContent: 'center' },
    passwordInput: { marginTop: 0, paddingRight: 48 },
    eyeButton: { position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: t.spacing.sm },
    error: { marginTop: t.spacing.md },
    submit: { marginTop: t.spacing.xl },
    toggle: { textAlign: 'center', marginTop: t.spacing.xl },
  })
