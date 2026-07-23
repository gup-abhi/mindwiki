import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { driftReport, type DriftReport, type SampledGap, type VersionIssue } from '@/services/wiki/drift'
import { type Theme, useThemedStyles } from '@/theme'

/**
 * Dev-only: measure rewrite drift across the real wiki from version_history —
 * the data the deferred consolidation-pass question is waiting on. Shows pooled
 * per-rewrite retention, origin (v1 → current) retention, and the driftiest
 * pages. Display only — the report holds page titles, so it is never logged.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`

function summarizeGaps(gaps: SampledGap[]): string[] {
  return gaps.map(
    (g) => `sampled history v${g.fromVersion}→v${g.toVersion} (${g.missing} version${g.missing === 1 ? '' : 's'} discarded; word-overlap step skipped across this gap)`
  )
}

function summarizeIssues(issues: VersionIssue[]): string[] {
  // Issues are flagged but never include page text or titles — they only carry
  // version numbers and a sanitized human string. Surface them verbatim.
  return issues.map((i) => `${i.type} @ v${i.version}: ${i.detail}`)
}

function DriftFlags({ gaps, issues }: { gaps: SampledGap[]; issues: VersionIssue[] }) {
  if (gaps.length === 0 && issues.length === 0) return null
  const lines = [...summarizeGaps(gaps), ...summarizeIssues(issues)]
  return (
    <View style={flagStyles.wrap}>
      {lines.map((l, i) => (
        <Text key={i} variant="caption" color="textMuted" style={flagStyles.line}>
          {l}
        </Text>
      ))}
    </View>
  )
}

const flagStyles = StyleSheet.create({
  wrap: { marginTop: 2, marginLeft: 0 },
  line: { fontSize: 10, fontStyle: 'italic' },
})

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
            `avg per-rewrite word overlap ${pct(res.data.meanStep)} · ` +
            `avg first→current word overlap ${pct(res.data.meanOrigin)}`
    )
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Measures WORD OVERLAP between rewrites — how much lexical content carries
        through each AI rewrite of the page. This is NOT a measure of semantic
        understanding; same words surviving or not is all it tracks. On-device
        only; the report holds page titles, so it is never logged.
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
            <View key={p.id} style={styles.row}>
              <Text variant="caption" color="textSecondary">
                {p.title} · v{p.versions} · word overlap step {pct(p.meanStep)}
                {p.steps.length === 0 ? ' (no adjacent step measurable)' : ` (min ${pct(p.minStep)})`}
                {p.origin != null ? ` · origin ${pct(p.origin)}` : ''}
              </Text>
              <DriftFlags gaps={p.gaps} issues={p.issues} />
            </View>
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
    row: { gap: 2 },
  })
