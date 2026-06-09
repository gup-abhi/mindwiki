import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'

import { Button, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { redeemPairing } from '@/services/sync/pairing'

/**
 * Device B: scan the QR shown by an already-signed-in device to pair this one.
 * On a successful scan, redeemPairing installs the master key + session and flips
 * auth state, so this screen unmounts into the app. onCancel returns to sign-in.
 */
export function PairScanScreen({ onCancel }: { onCancel: () => void }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
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
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      </Screen>
    )
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="heading">Camera access needed</Text>
          <Text variant="body" color="textSecondary" style={styles.subtitle}>
            We use the camera only to scan a pairing QR from your other device.
          </Text>
          <View style={styles.grant}>
            <Button title="Allow camera" onPress={() => requestPermission()} testID="pair-scan-grant" />
          </View>
          <Pressable onPress={onCancel} testID="pair-scan-cancel">
            <Text variant="label" color="accent" style={styles.cancel}>
              Back to sign in
            </Text>
          </Pressable>
        </View>
      </Screen>
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

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    subtitle: { textAlign: 'center', marginTop: t.spacing.sm },
    grant: { marginTop: t.spacing.xl },
    cancel: { marginTop: t.spacing.xl },
    overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: t.spacing['2xl'], paddingBottom: 56, alignItems: 'center' },
    scanTitle: { fontSize: 20, fontFamily: t.fontFamily.serifSemibold, color: '#fff' },
    scanHint: { fontSize: 14, fontFamily: t.fontFamily.uiRegular, color: '#ddd', marginTop: t.spacing.xs },
    spinner: { marginTop: t.spacing.lg },
    error: { color: '#ff9a9a', fontSize: 14, fontFamily: t.fontFamily.uiRegular, marginTop: t.spacing.lg, textAlign: 'center' },
    cancelBtn: { marginTop: t.spacing.lg, paddingVertical: t.spacing.md, paddingHorizontal: t.spacing['2xl'], borderRadius: t.radii.md, borderWidth: 1, borderColor: '#fff' },
    cancelBtnText: { color: '#fff', fontSize: 15, fontFamily: t.fontFamily.uiSemibold },
  })
