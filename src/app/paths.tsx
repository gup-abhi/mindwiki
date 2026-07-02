import { StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

import { Card, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { GUIDED_PATHS } from '@/lib/guided-paths'

/**
 * Browse the guided reflection paths — short, themed sequences the user works
 * through in one sitting. Reached from the Home card. Each card opens the runner.
 */
export default function PathsScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)

  return (
    <Screen scroll>
      <Text variant="title" style={styles.title}>
        Guided reflections
      </Text>
      <Text variant="body" color="textSecondary" style={styles.intro}>
        A few gentle prompts to work through, one at a time. Whatever you write feeds your wiki.
      </Text>

      {GUIDED_PATHS.map((path) => (
        <Card
          key={path.id}
          variant="surface"
          style={styles.card}
          onPress={() => router.push(`/paths/${path.id}`)}
          testID={`path-${path.id}`}
        >
          <Text variant="heading">{path.title}</Text>
          <Text variant="body" color="textSecondary" style={styles.cardDesc}>
            {path.description}
          </Text>
          <Text variant="caption" color="textMuted" style={styles.cardMeta}>
            {path.steps.length} prompts
          </Text>
        </Card>
      ))}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    title: { marginTop: t.spacing.md },
    intro: { marginTop: t.spacing.sm, marginBottom: t.spacing.xl },
    card: { marginBottom: t.spacing.md },
    cardDesc: { marginTop: t.spacing.xs },
    cardMeta: { marginTop: t.spacing.sm },
  })
