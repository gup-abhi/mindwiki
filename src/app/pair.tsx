import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

import { Button, IconButton, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { startPairing } from '@/services/sync/pairing'
import { authenticate } from '@/services/auth/biometric'

// Matches the server pairing-code TTL (PAIR_TTL_SECONDS = 300). Refreshing at the
// TTL lands just before the server code actually expires (mint latency), so the
// code on screen is always scannable without the user tapping "Reload code".
const PAIR_CODE_TTL_MS = 5 * 60 * 1000

/**
 * Device A: show a QR that pairs a new device. The QR carries a one-time code +
 * the master key (key never goes to the server). It expires in 5 minutes, and
 * anyone who scans it gets full access — so it's an in-person, proximity flow.
 * The code can be regenerated (expiry) or retried (network failure).
 */
export default function Pair() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [payload, setPayload] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // generate() awaits biometric auth + a network round-trip; guard against
  // setState after the screen is unmounted (e.g. the user navigates away mid-flow).
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPayload(null)
    // Always require a fresh identity check before exposing the QR — it carries
    // the master key and grants full access, so an unlocked phone alone must not
    // be enough to pair another device.
    const allowed = await authenticate('Confirm it’s you to pair a new device')
    if (!mounted.current) return
    if (!allowed) {
      setLoading(false)
      setError('Authentication required to pair a new device.')
      return
    }
    const res = await startPairing()
    if (!mounted.current) return
    setLoading(false)
    if (res.success) setPayload(res.data)
    else setError('Couldn’t start pairing. Check your connection and try again.')
  }, [])

  useEffect(() => {
    void generate()
  }, [generate])

  // Auto-refresh the code at its 5-minute expiry while the screen is open.
  useEffect(() => {
    if (!payload) return
    const id = setTimeout(() => void generate(), PAIR_CODE_TTL_MS)
    return () => clearTimeout(id)
  }, [payload, generate])

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back to Settings"
          onPress={() => router.back()}
          testID="pair-back"
        />
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" variant="title">
            Pair a new device
          </Text>
        </View>
      </View>
      <Text variant="body" color="textSecondary" style={styles.subtitle}>
        On your new device, choose “Pair with another device” and scan this code. It expires in 5
        minutes. Anyone who scans it gets full access — only show it to a device you own.
      </Text>
      <View style={styles.qrWrap} testID="pair-qr">
        {loading ? (
          <ActivityIndicator size="large" color={theme.colors.accent} />
        ) : error ? (
          <>
            <Text variant="caption" color="danger" style={styles.error}>
              {error}
            </Text>
            <View style={styles.retry}>
              <Button title="Try again" onPress={() => generate()} testID="pair-retry" />
            </View>
          </>
        ) : payload ? (
          <>
            {/* QR stays black-on-white for reliable scanning in any theme. */}
            <View style={styles.qrCode}>
              <QRCode value={payload} size={240} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload pairing code"
              style={styles.reload}
              onPress={() => generate()}
              testID="pair-reload"
            >
              <Text variant="label" color="accent">
                Reload code
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, paddingTop: t.spacing.lg },
    headerContent: { flex: 1 },
    subtitle: { marginTop: t.spacing.sm },
    qrWrap: { alignItems: 'center', justifyContent: 'center', marginTop: t.spacing['3xl'], minHeight: 240 },
    qrCode: { backgroundColor: '#fff', padding: t.spacing.md, borderRadius: t.radii.md },
    error: { textAlign: 'center' },
    retry: { marginTop: t.spacing.lg },
    reload: {
      minHeight: 48,
      marginTop: t.spacing.xl,
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.xl,
      justifyContent: 'center',
    },
  })
