import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, Card, IconButton, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useDismissedPages } from '@/hooks/useWiki'
import { restorePage } from '@/services/storage/wiki'

export default function DismissedWikiScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { pages, refresh } = useDismissedPages()

  const onRestore = async (id: string) => {
    await restorePage(id)
    await refresh()
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="dismissed-back"
        />
        <Text variant="title">Dropped insights</Text>
        <View style={styles.spacer} />
      </View>

      {pages.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="body" color="textMuted" style={styles.emptyText}>
            Nothing dropped. Insights you mark as inaccurate show up here, and you can
            bring them back anytime.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {pages.map((p) => (
            <Card key={p.id} variant="sunken" style={styles.card} testID="dismissed-row">
              <Text variant="bodyStrong" onPress={() => router.push(`/wiki/${p.id}`)}>
                {p.title}
              </Text>
              <Text variant="caption" color="textMuted" style={styles.meta}>
                {p.category ?? 'page'}
              </Text>
              <Button
                title="Restore"
                size="sm"
                variant="secondary"
                onPress={() => onRestore(p.id)}
                testID={`dismissed-restore-${p.id}`}
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.lg },
    spacer: { width: 40 }, // balances the back button so the title stays centered
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing['2xl'] },
    emptyText: { textAlign: 'center', lineHeight: 22 },
    list: { paddingBottom: t.spacing.xl },
    card: { marginBottom: t.spacing.md, alignItems: 'flex-start', gap: t.spacing.sm },
    meta: { textTransform: 'uppercase' },
  })
