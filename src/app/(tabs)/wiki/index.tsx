import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { SectionList, StyleSheet } from 'react-native'

import { Divider, EmptyState, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type WikiPage } from '@/services/storage/wiki'
import { useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'

// Pages are grouped by the category the wiki engine assigns (emotion /
// distortion / theme); anything else falls into "Other".
const CATEGORY_ORDER = ['emotion', 'distortion', 'theme', 'other'] as const
const CATEGORY_LABEL: Record<string, string> = {
  emotion: 'Emotions',
  distortion: 'Distortions',
  theme: 'Themes',
  other: 'Other',
}

interface Section {
  title: string
  data: WikiPage[]
}

function groupByCategory(pages: WikiPage[]): Section[] {
  const buckets = new Map<string, WikiPage[]>()
  for (const p of pages) {
    const key = p.category && CATEGORY_LABEL[p.category] ? p.category : 'other'
    const bucket = buckets.get(key) ?? []
    bucket.push(p)
    buckets.set(key, bucket)
  }
  return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
    title: CATEGORY_LABEL[c],
    data: buckets.get(c) ?? [],
  }))
}

export default function WikiBrowse() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { pages, loading } = useWikiPages()
  const synthesizing = useWikiStore((s) => s.pending > 0)
  const sections = useMemo(() => groupByCategory(pages), [pages])

  return (
    <Screen padded={false}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <>
            <Text variant="title" style={styles.title}>
              Your wiki
            </Text>
            {synthesizing && (
              <Text variant="caption" color="accent" style={styles.synth}>
                Synthesizing…
              </Text>
            )}
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="book-outline"
              title="No pages yet"
              message="Write a few entries and they’ll be synthesized here."
            />
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text variant="label" color="textMuted" style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            subtitle={`${item.category ?? 'page'} · ${item.entry_count} ${
              item.entry_count === 1 ? 'entry' : 'entries'
            }`}
            onPress={() => router.push(`/wiki/${item.id}`)}
          />
        )}
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    listContent: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md, paddingBottom: t.spacing['2xl'] },
    title: { marginBottom: t.spacing.md },
    synth: { marginTop: -t.spacing.sm, marginBottom: t.spacing.md },
    sectionHeader: {
      marginTop: t.spacing.xl,
      marginBottom: t.spacing.sm,
      textTransform: 'uppercase',
    },
  })
