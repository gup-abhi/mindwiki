import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { listPages } from '@/services/storage/wiki'
import { listAllSourceEntriesForPage } from '@/services/wiki/reground-evidence'
import { scanReGroundDuePages } from '@/services/wiki/engine'

/**
 * Dev-only controls for the production re-ground scan. Dry run applies the
 * same due criteria as the scan; Run invokes the production path. Only rendered
 * under __DEV__.
 */

export function DevReGround() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  function append(msg: string) {
    setLog((prev) => [...prev, msg])
  }

  async function dryRun() {
    setBusy(true)
    setLog([])
    try {
      const pages = await listPages()
      if (!pages.success) { append('Failed to list pages'); return }
      const due = await Promise.all(
        pages.data.map(async (p) => {
          if (
            p.category == null ||
            p.category === 'emotion' ||
            p.dismissed_at != null ||
            p.entry_count <= 0 ||
            p.content.length === 0 ||
            Date.now() - p.created_at <= 24 * 60 * 60 * 1000
          ) return false
          const sources = await listAllSourceEntriesForPage(p.title, p.category)
          return sources.success && sources.data.length - p.regrounded_upto >= 10
        })
      )
      const eligible = due.filter(Boolean).length
      append(eligible === 0 ? 'No due pages found.' : `${eligible} page(s) due for production re-ground scan.`)
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    setLog([])
    try {
      const result = await scanReGroundDuePages()
      if (!result.success) {
        append('Re-ground scan failed')
        return
      }
      append(`Done — ${result.data} page(s) re-grounded through production scan`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Run production re-ground scan for pages with 10+ fresh matching sources
        and minimum age. The scan uses CAS, receipts, and durable watermarks.
        Runs on the deep model — expect ~15-20s per page on device.
      </Text>
      <View style={styles.btns}>
        <Button title="Dry run (list eligible)" fullWidth onPress={() => void dryRun()} loading={busy} testID="dev-reground-dry" />
        <Button title="Re-ground all eligible" variant="secondary" fullWidth onPress={() => void run()} loading={busy} testID="dev-reground-run" />
      </View>
      {log.length > 0 && (
        <View style={styles.log}>
          {log.map((line, i) => (
            <Text key={i} variant="caption" color={line.startsWith('  ✓') ? 'success' : line.startsWith('  ✕') ? 'danger' : 'textMuted'}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    btns: { marginTop: t.spacing.md, gap: t.spacing.sm },
    log: { marginTop: t.spacing.md, gap: t.spacing.xs },
  })
