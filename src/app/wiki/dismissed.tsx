import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, IconButton, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useDismissedPages } from '@/hooks/useWiki'
import { restorePage } from '@/services/storage/wiki'

export default function DismissedWikiScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { pages, loading, refresh } = useDismissedPages()

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
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" variant="title">Dropped insights</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <Text variant="body" color="textMuted" style={styles.emptyText}>Loading dropped insights…</Text>
        </View>
      ) : pages.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="body" color="textMuted" style={styles.emptyText}>
            Nothing dropped. Insights you mark as inaccurate show up here, and you can
            bring them back anytime.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {pages.map((p) => (
            <View key={p.id} testID="dismissed-row" style={styles.card}>
              <ListRow
                title={p.title}
                subtitle={p.category ?? 'page'}
                onPress={() => router.push(`/wiki/${p.id}`)}
              />
              <Button
                title="Restore"
                size="sm"
                variant="secondary"
                onPress={() => onRestore(p.id)}
                testID={`dismissed-restore-${p.id}`}
              />
            </View>
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
