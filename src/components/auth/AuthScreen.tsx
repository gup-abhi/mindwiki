import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { Button, Text, TextField } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
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
export function AuthScreen({ initialMode = 'register' }: { initialMode?: AuthMode }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [recovering, setRecovering] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { submit, submitting, error, pendingPhrase, recoveryPending, confirmPhrase, retryPendingRecovery } = useAuth()

  if (recoveryPending && !pendingPhrase) {
    return (
      <View style={styles.pendingGate}>
        <Text variant="heading">Recovery phrase setup</Text>
        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          {error ?? 'Preparing a fresh recovery phrase for this account.'}
        </Text>
        <View style={styles.submit}>
          <Button title="Try again" variant="secondary" loading={submitting} disabled={submitting} fullWidth onPress={retryPendingRecovery} testID="recovery-retry" />
        </View>
      </View>
    )
  }

  // After a successful register, show the recovery phrase once before entering.
  if (pendingPhrase) {
    return (
      <RecoveryPhraseView
        phrase={pendingPhrase.phrase}
        onConfirm={confirmPhrase}
        onRetry={retryPendingRecovery}
        loading={submitting}
        error={error}
      />
    )
  }
  if (recovering) return <RecoverScreen onCancel={() => setRecovering(false)} />
  if (scanning) return <PairScanScreen onCancel={() => setScanning(false)} />

  const isRegister = mode === 'register'
  // A typo'd password at registration wraps the escrow with the wrong key — the
  // user could never log back in. Require a matching confirmation on register.
  const passwordsMatch = !isRegister || confirm === password
  // Email is required for both flows: login looks the account up by email, and
  // it's the only way back into the escrow, so an email-less account is a lockout.
  const canSubmit = isValidEmail(email) && password.length >= 8 && passwordsMatch && !submitting

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={theme.statusBar} />
      <View style={styles.body}>
        <Text accessibilityRole="header" variant="title">
          {isRegister ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text variant="body" color="textSecondary" style={styles.subtitle}>

          {isRegister
            ? 'Your journal and on-device AI stay private. An account only carries encrypted sync data across your own devices.'
            : 'Sign in to restore your encrypted journal and continue on this device.'}
        </Text>

        <TextField
          accessibilityLabel="Email"
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          testID="auth-email"
          style={styles.input}
        />
        <View style={styles.passwordWrap}>
          <TextField
            style={[styles.input, styles.passwordInput]}
            accessibilityLabel="Password"
            placeholder="Password (8+ characters)"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            textContentType={isRegister ? 'newPassword' : 'password'}
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
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={theme.colors.textMuted} />
          </Pressable>
        </View>

        {isRegister && (
          <>
            <View style={styles.passwordWrap}>
              <TextField
                style={[styles.input, styles.passwordInput]}
                accessibilityLabel="Confirm password"
                placeholder="Confirm password"
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                value={confirm}
                onChangeText={setConfirm}
                testID="auth-password-confirm"
              />
              <Pressable
                style={styles.eyeButton}
                onPress={() => setShowConfirm((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={showConfirm ? 'Hide password' : 'Show password'}
                testID="auth-password-confirm-toggle"
              >
                <Ionicons name={showConfirm ? 'eye-off' : 'eye'} size={22} color={theme.colors.textMuted} />
              </Pressable>
            </View>
            {confirm.length > 0 && confirm !== password && (
              <Text variant="caption" color="danger" style={styles.error}>
                Passwords don’t match.
              </Text>
            )}
          </>
        )}

        {error && (
          <Text variant="caption" color="danger" style={styles.error}>
            {error}
          </Text>
        )}

        <View style={styles.submit}>
          <Button
            title={isRegister ? 'Create account' : 'Sign in'}
            loading={submitting}
            disabled={!canSubmit}
            fullWidth
            onPress={() => submit(mode, email, password)}
            testID="auth-submit"
          />
        </View>

        <Pressable
          onPress={() => {
            setMode(isRegister ? 'login' : 'register')
            setConfirm('')
          }}
          disabled={submitting}
          testID="auth-toggle"
        >
          <Text variant="label" color="accent" style={styles.toggle}>
            {isRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </Pressable>

        {!isRegister && (
          <Pressable onPress={() => setRecovering(true)} disabled={submitting} testID="auth-forgot">
            <Text variant="caption" color="accent" style={styles.forgot}>
              Forgot password? Recover with your phrase
            </Text>
          </Pressable>
        )}

        <Pressable onPress={() => setScanning(true)} disabled={submitting} testID="auth-pair">
          <Text variant="caption" color="accent" style={styles.forgot}>
            Pair with another device
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.bg },
    pendingGate: { flex: 1, justifyContent: 'center', padding: t.spacing['2xl'], backgroundColor: t.colors.bg },
    body: { flex: 1, justifyContent: 'center', padding: t.spacing['2xl'] },
    subtitle: { marginTop: t.spacing.sm },
    input: { marginTop: t.spacing.lg },
    passwordWrap: { marginTop: t.spacing.lg, justifyContent: 'center' },
    passwordInput: { marginTop: 0, paddingRight: 48 },
    eyeButton: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      minWidth: 48,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: t.spacing.sm,
    },
    error: { marginTop: t.spacing.md },
    submit: { marginTop: t.spacing.xl },
    toggle: { textAlign: 'center', marginTop: t.spacing.xl },
    forgot: { textAlign: 'center', marginTop: t.spacing.lg },
  })
