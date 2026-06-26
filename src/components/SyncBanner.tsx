import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useSyncStore } from '@/store/sync.store'

/**
 * Shown right after signing in or pairing on a new device, while the first pull
 * restores the journal from the server. Without it the device lands on an empty
 * Home and the user fears their data is gone. Clears itself once the first sync
 * completes (engine calls endRestore).
 */
export function SyncBanner() {
  const restoring = useSyncStore((s) => s.restoring)
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()

  if (!restoring) return null

  return (
    <Card variant="accent" style={styles.card} testID="sync-banner">
      <View style={styles.row}>
        <ActivityIndicator color={theme.colors.accentText} />
        <View style={styles.text}>
          <Text variant="bodyStrong" color="accentText">
            Restoring your data…
          </Text>
          <Text variant="caption" color="accentText" style={styles.sub}>
            Syncing your journal and insights from the server. This can take a moment on a new device.
          </Text>
        </View>
      </View>
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { alignSelf: 'stretch', marginBottom: t.spacing.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
    text: { flex: 1 },
    sub: { marginTop: t.spacing.xs },
  })
