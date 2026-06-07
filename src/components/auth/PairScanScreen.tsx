import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'

import { redeemPairing } from '@/services/sync/pairing'

/**
 * Device B: scan the QR shown by an already-signed-in device to pair this one.
 * On a successful scan, redeemPairing installs the master key + session and flips
 * auth state, so this screen unmounts into the app. onCancel returns to sign-in.
 */
export function PairScanScreen({ onCancel }: { onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handled = useRef(false)

  const onScan = async (data: string) => {
    if (handled.current) return
    handled.current = true
    setBusy(true)
    setError(null)
    const res = await redeemPairing(data)
    if (!res.success) {
      setBusy(false)
      handled.current = false // let them try again with a fresh code
      setError('Couldn’t pair. Make sure the code is fresh, then try again.')
    }
    // success → redeemPairing authenticates; this screen unmounts
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.subtitle}>We use the camera only to scan a pairing QR from your other device.</Text>
        <Pressable style={styles.button} onPress={() => requestPermission()} testID="pair-scan-grant">
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={onCancel} testID="pair-scan-cancel">
          <Text style={styles.cancel}>Back to sign in</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : ({ data }) => onScan(data)}
      />
      <View style={styles.overlay}>
        <Text style={styles.scanTitle}>Scan the pairing QR</Text>
        <Text style={styles.scanHint}>Point at the code on your other device.</Text>
        {busy && <ActivityIndicator color="#fff" style={styles.spinner} />}
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={styles.cancelBtn} onPress={onCancel} testID="pair-scan-cancel">
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 28 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 15, color: '#666', marginTop: 8, textAlign: 'center', lineHeight: 22 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 28, paddingBottom: 56, alignItems: 'center' },
  scanTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  scanHint: { fontSize: 14, color: '#ddd', marginTop: 6 },
  spinner: { marginTop: 16 },
  error: { color: '#ff9a9a', fontSize: 14, marginTop: 16, textAlign: 'center' },
  button: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancel: { color: '#7a7ad0', fontSize: 15, fontWeight: '600', marginTop: 20 },
  cancelBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, borderWidth: 1, borderColor: '#fff' },
  cancelBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
