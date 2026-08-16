import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, Card, IconButton, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useNodeDismissals } from '@/hooks/useGraph'

export default function HiddenNodesScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { dismissals, restore } = useNodeDismissals()

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="hidden-back"
        />
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" variant="title">Hidden from connections</Text>
        </View>
      </View>

      {dismissals.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="body" color="textMuted" style={styles.emptyText}>
            Nothing hidden. Nodes you remove from your connections show up here, and you can
            bring them back anytime.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {dismissals.map((d) => (
            <Card key={d.id} variant="sunken" style={styles.card} testID="hidden-row">
              <Text variant="bodyStrong">{d.label}</Text>
              <Text variant="caption" color="textMuted" style={styles.meta}>
                {d.type}
              </Text>
              <Button
                title="Restore"
                size="sm"
                variant="secondary"
                onPress={() => void restore(d.id)}
                testID={`hidden-restore-${d.id}`}
              />
            </Card>
          ))}
        </ScrollView>
      )}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, paddingTop: t.spacing.lg, marginBottom: t.spacing.lg },
    headerContent: { flex: 1 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing['2xl'] },
    emptyText: { textAlign: 'center', lineHeight: 22 },
    list: { paddingBottom: t.spacing.xl },
    card: { marginBottom: t.spacing.md, alignItems: 'flex-start', gap: t.spacing.sm },
    meta: { textTransform: 'uppercase' },
  })
