import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

import { startPairing } from '@/services/sync/pairing'

/**
 * Device A: show a QR that pairs a new device. The QR carries a one-time code +
 * the master key (key never goes to the server). It expires in 5 minutes, and
 * anyone who scans it gets full access — so it's an in-person, proximity flow.
 */
export default function Pair() {
  const router = useRouter()
  const [payload, setPayload] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void startPairing().then((res) => {
      if (res.success) setPayload(res.data)
      else setError('Couldn’t start pairing. Check your connection and try again.')
    })
  }, [])

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
        {payload ? (
          <QRCode value={payload} size={240} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator size="large" color="#1a1a2e" />
        )}
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
})
