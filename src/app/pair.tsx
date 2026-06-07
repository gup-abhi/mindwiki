import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

import { startPairing } from '@/services/sync/pairing'

/**
 * Device A: show a QR that pairs a new device. The QR carries a one-time code +
 * the master key (key never goes to the server). It expires in 5 minutes, and
 * anyone who scans it gets full access — so it's an in-person, proximity flow.
 * The code can be regenerated (expiry) or retried (network failure).
 */
export default function Pair() {
  const router = useRouter()
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
    <View style={styles.container}>
      <Pressable onPress={() => router.back()} testID="pair-back">
        <Text style={styles.back}>‹ Settings</Text>
      </Pressable>
      <Text style={styles.title}>Pair a new device</Text>
      <Text style={styles.subtitle}>
        On your new device, choose “Pair with another device” and scan this code. It expires in 5
        minutes. Anyone who scans it gets full access — only show it to a device you own.
      </Text>
      <View style={styles.qrWrap} testID="pair-qr">
        {loading ? (
          <ActivityIndicator size="large" color="#1a1a2e" />
        ) : error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Pressable style={styles.button} onPress={() => generate()} testID="pair-retry">
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </>
        ) : payload ? (
          <>
            <QRCode value={payload} size={240} />
            <Pressable style={styles.reload} onPress={() => generate()} testID="pair-reload">
              <Text style={styles.reloadText}>Reload code</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24, paddingTop: 64 },
  back: { fontSize: 16, color: '#7a7ad0', fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e', marginTop: 8 },
  subtitle: { fontSize: 15, color: '#666', marginTop: 8, lineHeight: 22 },
  qrWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 40, minHeight: 240 },
  error: { color: '#d12f2f', fontSize: 14, textAlign: 'center' },
  button: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reload: { marginTop: 24, paddingVertical: 10, paddingHorizontal: 24 },
  reloadText: { color: '#7a7ad0', fontSize: 15, fontWeight: '600' },
})
