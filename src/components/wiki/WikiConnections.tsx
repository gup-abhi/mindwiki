import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type GraphNode } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { useWikiConnections } from '@/hooks/useWikiConnections'

/**
 * The "Often comes up with" block on a wiki page — a deterministic, tappable
 * chip per graph connection (Level 2). Connections are computed in
 * useWikiConnections from the local graph (always fresh, no persisted structured
 * data), NOT woven into the page's LLM prose. Each chip resolves:
 *  - a live wiki page with a matching title → opens that page ("/wiki/:id")
 *  - no matching page (a graph node only, e.g. "Sleep") → opens the Map with
 *    that node focused ("/graph?focus=<label>").
 *
 * Presentation-only: state and storage reads live in useWikiConnections.
 * Render decisions:
 *   - loading → null (no flash of empty block during normal load — matches prior UX)
 *   - error   → small, unobtrusive dev diagnostic row, never labels/titles
 *   - loaded, empty labels → null (the node has no neighbours — normal)
 *   - loaded, labels present → block with tappable chips
 */
export function WikiConnections({ title, category }: { title: string; category?: string | null }) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { status, labels, nodes, pages, error } = useWikiConnections(title, category)

  if (status === 'loading') return null

  if (status === 'error') {
    // Unobtrusive dev diagnostic — counts only, never logs labels.
    // In production this is a single muted row; if no diagnostic is requested
    // the row can be hidden entirely by returning null here.
    return (
      <View style={styles.section} testID="wiki-connections-error">
        <Text variant="caption" color="textSecondary">
          {error}
        </Text>
      </View>
    )
  }

  // status === 'loaded'
  if (labels.length === 0) return null

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
            else {
              const node = resolveNode(label, nodes)
              if (node) router.push({ pathname: '/graph', params: { nodeId: node.id } })
            }
          }
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={
                page ? `Open the ${label} page` : `See ${label} in your connections`
              }
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

/**
 * Match a connection label to a live wiki page, case-insensitively (the
 * graph label and the page title need not agree on casing). Returns null when
 * the connection is a graph node only (no page) — the chip then links to the
 * focused node in the Map instead. Pure: caller passes the current page list.
 */
function resolvePage(label: string, live: WikiPage[]): WikiPage | null {
  const key = label.trim().toLowerCase()
  return live.find((p) => p.title.trim().toLowerCase() === key) ?? null
}

function resolveNode(label: string, nodes: GraphNode[]): GraphNode | null {
  const key = label.trim().toLowerCase()
  return nodes.find((node) => node.label.trim().toLowerCase() === key) ?? null
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    section: { marginTop: t.spacing.xl, gap: t.spacing.xs },
    title: {},
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
    chip: {
      minHeight: 48,
      borderRadius: t.radii.pill,
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.md,
      backgroundColor: t.colors.surfaceAlt,
      justifyContent: 'center',
    },
    chipLink: { backgroundColor: t.colors.accentMuted },
  })
