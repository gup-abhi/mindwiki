import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { backfillEmotionPlaceholders } from '@/services/wiki/engine'
import { useSyncStore } from '@/store/sync.store'

/**
 * Dev-only: one-time backfill that seeds active emotion pages created blank
 * (before the first-touch placeholder existed) with placeholder text, so they
 * no longer surface as empty pages in the wiki. Deterministic — no LLM call. A
 * seeded page is still replaced by its first real aggregate synthesis once it
 * clears the aggregate gates. Only rendered under __DEV__.
 */

export function DevEmotionPlaceholderBackfill() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  function append(msg: string) {
    setLog((prev) => [...prev, msg])
  }

  // Replace the last log line — transitions a page's "seeding" line to its
  // "done"/"failed" result in place, so each page stays on one line.
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
        .filter(
          (p) =>
            p.category === 'emotion' &&
            p.content.trim() === '' &&
            p.dismissed_at == null &&
            p.merged_into == null
        )
        .map((p) => p.title)
      if (eligible.length === 0) {
        append('No blank emotion pages to seed.')
      } else {
        append(`${eligible.length} blank emotion page(s) eligible:`)
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
      const result = await backfillEmotionPlaceholders((p) => {
        if (p.status === 'start') {
          append(`  … "${p.title}" (${p.index}/${p.total}) — seeding`)
        } else if (p.status === 'done') {
          replaceLast(`  ✓ "${p.title}" (${p.index}/${p.total})`)
        } else {
          replaceLast(`  ✗ "${p.title}" (${p.index}/${p.total}) — failed`)
        }
      })
      if (!result.success) { append('Backfill failed.'); return }
      if (result.data.length === 0) {
        append('No blank emotion pages needed seeding.')
      } else {
        append(`Done — seeded ${result.data.length} page(s).`)
      }
      useSyncStore.getState().bumpRevision()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Seed blank emotion pages (created before the first-touch placeholder
        existed) with placeholder text so they stop showing up empty. The first
        real aggregate synthesis still replaces the placeholder later.
      </Text>
      <View style={styles.btns}>
        <Button title="Dry run (list blank)" fullWidth onPress={() => void dryRun()} loading={busy} testID="dev-emotion-backfill-dry" />
        <Button title="Seed blank emotion pages" variant="secondary" fullWidth onPress={() => void run()} loading={busy} testID="dev-emotion-backfill-run" />
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
