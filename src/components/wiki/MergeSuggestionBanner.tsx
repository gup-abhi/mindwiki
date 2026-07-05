import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { useMergeSuggestions } from '@/hooks/useMergeSuggestions'
import { type Theme, useThemedStyles } from '@/theme'

/**
 * Suggests merging two theme pages that read as the same theme (by embedding
 * similarity) but share no words, so string dedup never caught them. The user
 * confirms — a merge is not reversible, so it's never automatic. Renders nothing
 * when there's no suggestion (the common case).
 */
export function MergeSuggestionBanner() {
  const styles = useThemedStyles(makeStyles)
  const { pair, busy, confirm, dismiss } = useMergeSuggestions()
  if (!pair) return null

  return (
    <Card style={styles.card}>
      <Text variant="subtitle">These may be the same theme</Text>
      <Text variant="body" color="textSecondary" style={styles.body}>
        “{pair.loser.title}” and “{pair.survivor.title}” look like the same idea.
        Merge them into “{pair.survivor.title}” so they grow as one page?
      </Text>
      <View style={styles.actions}>
        <Button title="Merge" onPress={confirm} loading={busy} />
        <Button title="Keep separate" variant="ghost" onPress={dismiss} disabled={busy} />
      </View>
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { marginHorizontal: t.spacing.md, marginTop: t.spacing.md },
    body: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    actions: { flexDirection: 'row', gap: t.spacing.sm },
  })
