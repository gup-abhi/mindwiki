import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { backfillConnectionLines } from '@/services/wiki/engine'
import { useSyncStore } from '@/store/sync.store'

/**
 * Dev-only: rewrite every active non-emotion wiki page that has graph neighbours,
 * injecting the graph connection line so existing pages reflect cross-topic
 * relationships. Runs on the deep model — expect ~15-20s per page on device.
 * Only rendered under __DEV__.
 */

export function DevConnectionBackfill() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  function append(msg: string) {
    setLog((prev) => [...prev, msg])
  }

  // Replace the last log line — used to transition a page's "rewriting" line to
  // its "done"/"failed" result in place, so each page stays on one line.
  function replaceLast(msg: string) {
    setLog((prev) => (prev.length > 0 ? [...prev.slice(0, -1), msg] : [msg]))
  }

  async function dryRun() {
    setBusy(true)
    setLog([])
    try {
      const { listPages } = await import('@/services/storage/wiki')
      const { listNodes, listEdges } = await import('@/services/storage/graph')
      const { connectionLine } = await import('@/services/graph/neighborhood')
      const [nodesRes, edgesRes] = await Promise.all([listNodes(), listEdges()])
      const nodes = nodesRes.success ? nodesRes.data : []
      const edges = edgesRes.success ? edgesRes.data : []
      if (nodes.length === 0 || edges.length === 0) {
        append('Graph is empty — no connection lines to backfill.')
        return
      }
      const pagesRes = await listPages()
      if (!pagesRes.success) { append('Failed to list pages.'); return }
      const eligible = pagesRes.data.filter((p) => {
        if (p.category === 'emotion') return false
        return connectionLine(p.title, nodes, edges) != null
      })
      if (eligible.length === 0) {
        append('No eligible pages with graph connections found.')
      } else {
        append(`${eligible.length} page(s) eligible:`)
        for (const p of eligible) {
          const line = connectionLine(p.title, nodes, edges)
          append(`  "${p.title}" — ${line}`)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    setLog([])
    try {
      const result = await backfillConnectionLines((p) => {
        if (p.status === 'start') {
          append(`  … "${p.title}" (${p.index}/${p.total}) — rewriting`)
        } else if (p.status === 'done') {
          replaceLast(`  ✓ "${p.title}" (${p.index}/${p.total})`)
        } else {
          replaceLast(`  ✗ "${p.title}" (${p.index}/${p.total}) — failed`)
        }
      })
      if (!result.success) { append('Backfill failed.'); return }
      if (result.data.length === 0) {
        append('No pages were rewritten.')
      } else {
        append(`Done — rewrote ${result.data.length} page(s).`)
      }
      useSyncStore.getState().bumpRevision()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Rewrite every active wiki page that has graph connections, injecting the
        connection line so pages reflect cross-topic relationships. Emotion pages
        are skipped (they surface triggers via aggregate data).
        {'\n'}Runs on the deep model — expect ~15-20s per page on device.
      </Text>
      <View style={styles.btns}>
        <Button title="Dry run (list eligible)" fullWidth onPress={() => void dryRun()} loading={busy} testID="dev-conn-backfill-dry" />
        <Button title="Backfill connection lines" variant="secondary" fullWidth onPress={() => void run()} loading={busy} testID="dev-conn-backfill-run" />
      </View>
      {log.length > 0 && (
        <View style={styles.log}>
          {log.map((line, i) => (
            <Text key={i} variant="caption" color={logColor(line)}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}

/** Colour a live log line by its status prefix. */
function logColor(line: string): 'success' | 'danger' | 'accent' | 'textMuted' {
  if (line.startsWith('  ✓')) return 'success'
  if (line.startsWith('  ✗')) return 'danger'
  if (line.startsWith('  …') || line.startsWith('  "')) return 'accent'
  return 'textMuted'
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    btns: { marginTop: t.spacing.md, gap: t.spacing.sm },
    log: { marginTop: t.spacing.md, gap: t.spacing.xs },
  })
