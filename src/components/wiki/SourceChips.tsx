import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Chip } from '@/components/ui'
import { type MessageSource } from '@/services/storage/chat'
import { type Theme, useThemedStyles } from '@/theme'

/** Citation chips under a companion reply — tap to open the wiki page it drew from. */
export function SourceChips({ sources }: { sources: MessageSource[] }) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.chips}>
      {sources.map((s) => (
        <Chip key={s.id} label={s.title} onPress={() => router.push(`/wiki/${s.id}`)} />
      ))}
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
      marginTop: t.spacing.sm,
    },
  })
