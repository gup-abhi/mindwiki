import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, Card, IconButton, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { usePursuits } from '@/hooks/usePursuits'
import { type PursuitStatus } from '@/services/storage/pursuits'

const STATUS_LABEL: Record<PursuitStatus, string> = {
  active: 'Active',
  done: 'Done',
  abandoned: 'Let go',
  dormant: 'Dormant',
}

export default function PursuitsScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { pursuits, setStatus, remove } = usePursuits()

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="pursuits-back"
        />
        <Text variant="title">Pursuits</Text>
        <View style={styles.spacer} />
      </View>

      {pursuits.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="body" color="textMuted" style={styles.emptyText}>
            Things you’re working on will show up here as you journal about them.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {pursuits.map((p) => (
            <Card key={p.id} variant="sunken" style={styles.card} testID="pursuit-row">
              <Text variant="bodyStrong">{p.title}</Text>
              <Text variant="caption" color="textMuted" style={styles.status}>
                {STATUS_LABEL[p.status]}
              </Text>
              {p.details ? (
                <Text variant="body" color="textSecondary" style={styles.details}>
                  {p.details}
                </Text>
              ) : null}
              <View style={styles.actions}>
                {p.status === 'active' ? (
                  <Button
                    title="Mark done"
                    size="sm"
                    variant="secondary"
                    onPress={() => setStatus(p.id, 'done')}
                    testID={`pursuit-done-${p.id}`}
                  />
                ) : (
                  <Button
                    title="Reactivate"
                    size="sm"
                    variant="secondary"
                    onPress={() => setStatus(p.id, 'active')}
                    testID={`pursuit-reactivate-${p.id}`}
                  />
                )}
                <Button
                  title="Remove"
                  size="sm"
                  variant="ghost"
                  onPress={() => remove(p.id)}
                  testID={`pursuit-remove-${p.id}`}
                />
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.lg },
    spacer: { width: 40 }, // balances the back button so the title stays centered
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing['2xl'] },
    emptyText: { textAlign: 'center', lineHeight: 22 },
    list: { paddingBottom: t.spacing.xl },
    card: { marginBottom: t.spacing.md },
    status: { marginTop: t.spacing.xs, textTransform: 'uppercase' },
    details: { marginTop: t.spacing.sm },
    actions: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.md },
  })
