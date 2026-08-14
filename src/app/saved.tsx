import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { useEntryLifecycle } from '@/hooks/useEntryLifecycle'
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
    cta: { marginTop: t.spacing.xl, alignSelf: 'stretch', paddingHorizontal: t.spacing['2xl'], gap: t.spacing.md },
  })

export default function SavedScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  // On a low-mood day, gently offer a breather before sending them home.
  const { id, mood } = useLocalSearchParams<{ id?: string; mood?: string }>()
  const lowMood = Number(mood) > 0 && Number(mood) <= 2
  const { status, refresh } = useEntryLifecycle(id)
  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={44} color={theme.colors.success} />
        </View>
        <Text variant="title">Saved privately</Text>
        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          Your reflection is encrypted on this device. You can leave now while private synthesis continues.
        </Text>
        {status === 'pending' && <Text variant="label" color="accent">Private synthesis</Text>}
        {status === 'ready' && <Text variant="label" color="accent">Insight ready</Text>}
        {status === 'unavailable' && <Text variant="caption" color="textMuted">Private synthesis is not available yet.</Text>}
        {status === 'retryable' && (
          <Button title="Check again" variant="ghost" onPress={refresh} testID="saved-retry" />
        )}
        {id && (
          <Button
            title="View saved entry"
            variant="secondary"
            fullWidth
            onPress={() => router.replace(`/entries/${id}`)}
            testID="saved-view-entry"
          />
        )}
        <View style={styles.cta}>
          {lowMood && (
            <Button
              title="Take a minute to breathe"
              variant="secondary"
              fullWidth
              onPress={() => router.replace('/breathe')}
              testID="saved-breathe"
            />
          )}
          <Button title="Done" fullWidth onPress={() => router.replace('/')} />
        </View>
      </View>
    </Screen>
  )
}
