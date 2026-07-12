import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { cleanupConnectionProse } from '@/services/wiki/engine'
import { stripConnectionProse } from '@/services/wiki/cleanup'
import { useSyncStore } from '@/store/sync.store'

/**
 * Dev-only: one-time cleanup that strips the connection-line prose (and the
 * "knowledge graph shows" scaffold leak) the old "connections in synthesis
 * prose" approach baked into stored page content. Connections now render as a
 * deterministic structured block (WikiConnections), so the stale prose is
 * removed from each active page that still carries it — deterministically, no
 * LLM call. Only rendered under __DEV__.
 */

export function DevConnectionCleanup() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  function append(msg: string) {
    setLog((prev) => [...prev, msg])
  }

  // Replace the last log line — used to transition a page's "cleaning" line to
  // its "done"/"failed" result in place, so each page stays on one line.
  function replaceLast(msg: string) {
    setLog((prev) => (prev.length > 0 ? [...prev.slice(0, -1), msg] : [msg]))
  }

  async function dryRun() {
    setBusy(true)
    setLog([])
    try {
      const { listPages } = await import('@/services/storage/wiki')
      const pagesRes = await listPages()
      if (!pagesRes.success) { append('Failed to list pages.'); return }
      const eligible = pagesRes.data
        .map((p) => ({ p, cleaned: stripConnectionProse(p.content) }))
        .filter((e) => e.cleaned !== e.p.content)
        .map((e) => e.p.title)
      if (eligible.length === 0) {
        append('No pages carry stale connection prose.')
      } else {
        append(`${eligible.length} page(s) eligible for cleanup:`)
        for (const t of eligible) append(`  "${t}"`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    setLog([])
    try {
      const result = await cleanupConnectionProse((p) => {
        if (p.status === 'start') {
          append(`  … "${p.title}" (${p.index}/${p.total}) — cleaning`)
        } else if (p.status === 'done') {
          replaceLast(`  ✓ "${p.title}" (${p.index}/${p.total})`)
        } else {
          replaceLast(`  ✗ "${p.title}" (${p.index}/${p.total}) — failed`)
        }
      })
      if (!result.success) { append('Cleanup failed.'); return }
      if (result.data.length === 0) {
        append('No pages carried stale connection prose.')
      } else {
        append(`Done — cleaned ${result.data.length} page(s).`)
      }
      useSyncStore.getState().bumpRevision()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Strip the old connection-line prose (and any "The knowledge graph shows…"
        scaffold leak) from every active wiki page. Connections now render as a
        structured chip block below the page instead of woven into prose — this
        removes the stale baked-in sentences deterministically (no LLM call).
      </Text>
      <View style={styles.btns}>
        <Button title="Dry run (list eligible)" fullWidth onPress={() => void dryRun()} loading={busy} testID="dev-conn-cleanup-dry" />
        <Button title="Clean stale connection prose" variant="secondary" fullWidth onPress={() => void run()} loading={busy} testID="dev-conn-cleanup-run" />
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
