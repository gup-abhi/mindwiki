import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { pageConnections } from '@/services/graph/neighborhood'
import { listNodes, listEdges } from '@/services/storage/graph'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { useSyncStore } from '@/store/sync.store'

/**
 * The "Often comes up with" block on a wiki page — a deterministic, tappable
 * chip per graph connection (Level 2). Connections are computed at render time
 * from the local graph (always fresh, no persisted structured data), NOT woven
 * into the page's LLM prose. Each chip resolves:
 *  - a live wiki page with a matching title → opens that page ("/wiki/:id")
 *  - no matching page (a graph node only, e.g. "Sleep") → opens the Map with
 *    that node focused ("/graph?focus=<label>").
 */
export function WikiConnections({ title }: { title: string }) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const revision = useSyncStore((s) => s.revision)
  const [labels, setLabels] = useState<string[] | null>(null)
  const [pages, setPages] = useState<WikiPage[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      const [nodesRes, edgesRes, pagesRes] = await Promise.all([
        listNodes(),
        listEdges(),
        listPages(),
      ])
      if (!active) return
      const nodes = nodesRes.success ? nodesRes.data : []
      const edges = edgesRes.success ? edgesRes.data : []
      const live = (pagesRes.success ? pagesRes.data : []).filter(
        (p) => p.dismissed_at == null && p.merged_into == null
      )
      setPages(live)
      setLabels(pageConnections(title, nodes, edges))
    })()
    return () => {
      active = false
    }
  }, [title, revision])

  if (labels == null || labels.length === 0) return null

  return (
    <View style={styles.section} testID="wiki-connections">
      <Text variant="label" color="textSecondary" style={styles.title}>
        Often comes up with
      </Text>
      <View style={styles.chips}>
        {labels.map((label) => {
          const page = resolvePage(label, pages)
          const onPress = () => {
            if (page) router.push(`/wiki/${page.id}`)
            else router.push({ pathname: '/graph', params: { focus: label } })
          }
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={page ? `Open the ${label} page` : `See ${label} in your connections`}
              onPress={onPress}
              style={[styles.chip, styles.chipLink]}
              testID={`wiki-connection-${label}`}
            >
              <Text variant="caption" color="accentText">
                {label} ›
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Match a connection label to a live wiki page, case-insensitively (the
 *  graph label and the page title need not agree on casing). Returns null when
 *  the connection is a graph node only (no page) — the chip then links to the
 *  focused node in the Map instead. Pure: caller passes the current page list. */
function resolvePage(label: string, live: WikiPage[]): WikiPage | null {
  const key = label.trim().toLowerCase()
  return live.find((p) => p.title.trim().toLowerCase() === key) ?? null
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    section: { marginTop: t.spacing.xl, gap: t.spacing.xs },
    title: {},
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
    chip: {
      borderRadius: t.radii.pill,
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.md,
      backgroundColor: t.colors.surfaceAlt,
    },
    chipLink: { backgroundColor: t.colors.accentMuted },
  })
