import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
    badge: {
      width: 88,
      height: 88,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.accentMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.sm,
    },
    subtitle: { textAlign: 'center', maxWidth: 300 },
    cta: { marginTop: t.spacing.xl, alignSelf: 'stretch', paddingHorizontal: t.spacing['2xl'] },
  })

export default function SavedScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={44} color={theme.colors.success} />
        </View>
        <Text variant="title">Entry saved</Text>
        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          Your reflection is encrypted on your device. Each entry grows your insights.
        </Text>
        <View style={styles.cta}>
          <Button title="Done" fullWidth onPress={() => router.replace('/')} />
        </View>
      </View>
    </Screen>
  )
}
