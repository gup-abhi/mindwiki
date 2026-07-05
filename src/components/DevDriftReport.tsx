import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { driftReport, type DriftReport } from '@/services/wiki/drift'
import { type Theme, useThemedStyles } from '@/theme'

/**
 * Dev-only: measure rewrite drift across the real wiki from version_history —
 * the data the deferred consolidation-pass question is waiting on. Shows pooled
 * per-rewrite retention, origin (v1 → current) retention, and the driftiest
 * pages. Display only — the report holds page titles, so it is never logged.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`

export function DevDriftReport() {
  const styles = useThemedStyles(makeStyles)
  const [report, setReport] = useState<DriftReport | null>(null)
  const [status, setStatus] = useState('')

  async function measure() {
    const res = await driftReport()
    if (!res.success) {
      setStatus(`Failed: ${res.error.code}`)
      return
    }
    setReport(res.data)
    setStatus(
      res.data.pageCount === 0
        ? 'No page has been rewritten yet — nothing to measure.'
        : `${res.data.pageCount} pages, ${res.data.rewriteCount} rewrites · ` +
            `avg per-rewrite retention ${pct(res.data.meanStep)} · ` +
            `avg first→current retention ${pct(res.data.meanOrigin)}`
    )
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Measures how much of each wiki page survives its rewrites (content-word retention from
        version history) — the drift data the deferred consolidation pass is waiting on.
      </Text>
      <View style={styles.btns}>
        <Button title="Measure wiki drift" fullWidth onPress={() => void measure()} testID="dev-drift-report" />
      </View>
      {!!status && (
        <Text variant="caption" color="accent" style={styles.status}>
          {status}
        </Text>
      )}
      {report && report.pages.length > 0 && (
        <View style={styles.list}>
          {report.pages.slice(0, 5).map((p) => (
            <Text key={p.id} variant="caption" color="textSecondary">
              {p.title} · v{p.versions} · step {pct(p.meanStep)} (min {pct(p.minStep)})
              {p.origin != null ? ` · origin ${pct(p.origin)}` : ''}
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    btns: { marginTop: t.spacing.md },
    status: { marginTop: t.spacing.sm },
    list: { marginTop: t.spacing.sm, gap: t.spacing.xs },
  })
