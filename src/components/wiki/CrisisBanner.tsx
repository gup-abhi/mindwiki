import { Linking, StyleSheet } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { CRISIS_RESOURCES } from '@/services/crisis/resources'
import { type Theme, useThemedStyles } from '@/theme'

/**
 * Inline crisis support shown beneath a message that tripped the crisis net.
 * Offers human support resources only — the app does not diagnose or treat.
 */
export function CrisisBanner() {
  const styles = useThemedStyles(makeStyles)
  return (
    <Card style={styles.card}>
      <Text variant="subtitle">You don’t have to go through this alone</Text>
      <Text variant="body" color="textSecondary" style={styles.body}>
        These services are free and confidential.
      </Text>
      <Button
        title="Call or text 988"
        variant="destructive"
        fullWidth
        onPress={() => Linking.openURL('tel:988')}
      />
      {CRISIS_RESOURCES.map((r) => (
        <Text key={r.name} variant="caption" color="textSecondary" style={styles.resource}>
          {r.name} — {r.contact}
        </Text>
      ))}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { marginTop: t.spacing.sm },
    body: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    resource: { marginTop: t.spacing.sm },
  })
