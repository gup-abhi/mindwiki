import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

import { Button, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { startPairing } from '@/services/sync/pairing'

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

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPayload(null)
    const res = await startPairing()
    setLoading(false)
    if (res.success) setPayload(res.data)
    else setError('Couldn’t start pairing. Check your connection and try again.')
  }, [])

  useEffect(() => {
    void generate()
  }, [generate])

  return (
    <Screen>
      <Pressable onPress={() => router.back()} testID="pair-back">
        <Text variant="label" color="accent">
          ‹ Settings
        </Text>
      </Pressable>
      <Text variant="title" style={styles.title}>
        Pair a new device
      </Text>
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
            <Pressable style={styles.reload} onPress={() => generate()} testID="pair-reload">
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
    title: { marginTop: t.spacing.sm },
    subtitle: { marginTop: t.spacing.sm },
    qrWrap: { alignItems: 'center', justifyContent: 'center', marginTop: t.spacing['3xl'], minHeight: 240 },
    qrCode: { backgroundColor: '#fff', padding: t.spacing.md, borderRadius: t.radii.md },
    error: { textAlign: 'center' },
    retry: { marginTop: t.spacing.lg },
    reload: { marginTop: t.spacing.xl, paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.xl },
  })
