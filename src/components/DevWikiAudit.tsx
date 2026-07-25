import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { listNodes, listEdges } from '@/services/storage/graph'
import { getMaintenanceState } from '@/services/storage/maintenance-state'
import { getSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { listPages } from '@/services/storage/wiki'
import { listAllSourceEntriesForPage } from '@/services/wiki/reground-evidence'
import { runBeliefMaintenance } from '@/services/wiki/belief-maintenance'
import { scanReGroundDuePages } from '@/services/wiki/engine'
import { runStartupMaintenanceForDev } from '@/services/storage/bootstrap'

const TOPIC_TRUNCATION_COUNT_KEY = 'topic_truncation_count'
const BELIEF_GRAPH_PENDING_KEY = 'mw_belief_repair_graph_pending'
const MERGE_GRAPH_PENDING_KEY = 'maintenance:graph_rebuild_required'
const RE_GROUND_INTERVAL = 10
const RE_GROUND_AGE_MS = 24 * 60 * 60 * 1000

interface AuditSnapshot {
  models: { fast: boolean; deep: boolean; embed: boolean }
  activePages: number
  duePages: number
  matchingSources: number
  receipts: number
  graphNodes: number
  graphEdges: number
  topicTruncations: number
  maintenance: string
  sourceGeneration: number
  processedGeneration: number
  graphPending: boolean
  mergeGraphPending: boolean
}

function countRows(rows: Record<string, unknown>[]): number {
  return Number(rows[0]?.count ?? 0)
}

async function readSnapshot(): Promise<AuditSnapshot> {
  const [fast, deep, embed, pagesRes, maintenanceRes, truncationsRes, beliefMarkerRes, mergeMarkerRes, nodesRes, edgesRes] = await Promise.all([
    isModelDownloaded('fast'),
    isModelDownloaded('deep'),
    isModelDownloaded('embed'),
    listPages(),
    getMaintenanceState(),
    getSetting(TOPIC_TRUNCATION_COUNT_KEY),
    getSetting(BELIEF_GRAPH_PENDING_KEY),
    getSetting(MERGE_GRAPH_PENDING_KEY),
    listNodes(),
    listEdges(),
  ])

  const db = getDb()
  const receiptRes = await db.execute('SELECT COUNT(*) AS count FROM wiki_page_contributions')
  if (!pagesRes.success) throw new Error(pagesRes.error.code)

  let duePages = 0
  let matchingSources = 0
  for (const page of pagesRes.data) {
    if (page.category == null || page.dismissed_at != null) continue
    const sources = await listAllSourceEntriesForPage(page.title, page.category)
    const count = sources.success ? sources.data.length : 0
    matchingSources += count
    if (count - page.regrounded_upto >= RE_GROUND_INTERVAL && Date.now() - page.created_at > RE_GROUND_AGE_MS) {
      duePages++
    }
  }

  return {
    models: { fast, deep, embed },
    activePages: pagesRes.data.length,
    duePages,
    matchingSources,
    receipts: countRows(receiptRes.rows),
    graphNodes: nodesRes.success ? nodesRes.data.length : 0,
    graphEdges: edgesRes.success ? edgesRes.data.length : 0,
    topicTruncations: truncationsRes.success ? Number(truncationsRes.data ?? 0) : 0,
    maintenance: maintenanceRes.success ? maintenanceRes.data.status : 'read-error',
    sourceGeneration: maintenanceRes.success ? maintenanceRes.data.source_generation : 0,
    processedGeneration: maintenanceRes.success ? maintenanceRes.data.processed_generation : 0,
    graphPending: beliefMarkerRes.success && beliefMarkerRes.data === '1',
    mergeGraphPending: mergeMarkerRes.success && mergeMarkerRes.data === '1',
  }
}

function modelText(models: AuditSnapshot['models']): string {
  return `Models fast ${models.fast ? 'yes' : 'no'} · deep ${models.deep ? 'yes' : 'no'} · embed ${models.embed ? 'yes' : 'no'}`
}

/** Dev-only count/state panel for on-device wiki audit verification. */
export function DevWikiAudit() {
  const styles = useThemedStyles(makeStyles)
  const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function refresh() {
    setBusy(true)
    setMessage('')
    try {
      setSnapshot(await readSnapshot())
    } catch {
      setMessage('Audit read failed')
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setMessage('')
    try {
      setMessage(await action())
      setSnapshot(await readSnapshot())
    } catch {
      setMessage('Audit action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="bodyStrong">Wiki structural audit</Text>
      <Text variant="caption" color="textSecondary" style={styles.line}>
        Count-only checks for device validation. No page, belief, or journal text is shown.
      </Text>
      <View style={styles.buttons}>
        <Button title="Refresh audit" fullWidth onPress={() => void refresh()} loading={busy} testID="dev-wiki-audit-refresh" />
        <Button
          title="Run startup maintenance"
          variant="secondary"
          fullWidth
          onPress={() => void run(async () => {
            await runStartupMaintenanceForDev()
            return 'Startup maintenance complete'
          })}
          loading={busy}
          testID="dev-wiki-audit-maintenance"
        />
        <Button
          title="Run production re-ground scan"
          variant="secondary"
          fullWidth
          onPress={() => void run(async () => {
            const result = await scanReGroundDuePages()
            return result.success ? `Re-grounded ${result.data} page(s)` : 'Re-ground scan failed'
          })}
          loading={busy}
          testID="dev-wiki-audit-reground"
        />
        <Button
          title="Run belief maintenance"
          variant="secondary"
          fullWidth
          onPress={() => void run(async () => {
            const result = await runBeliefMaintenance()
            if (result.success) {
              return `Repaired ${result.data.repairedClusters} cluster(s)`
            }
            const message = result.error.message.toLowerCase()
            if (result.error.code === 'BELIEF_LANDSCAPE_FAILED' && message.includes('no such table')) {
              return 'Belief maintenance failed: schema missing — restart app to finish migrations'
            }
            if (result.error.code === 'BELIEF_MAINTENANCE_GRAPH_FAILED') {
              return 'Belief maintenance failed: graph rebuild — retry after closing other work'
            }
            return `Belief maintenance failed: ${result.error.code}`
          })}
          loading={busy}
          testID="dev-wiki-audit-belief"
        />
      </View>
      {snapshot && (
        <View style={styles.readout}>
          <Text variant="caption" color="textSecondary">{modelText(snapshot.models)}</Text>
          <Text variant="caption" color="textSecondary">Pages {snapshot.activePages} · due {snapshot.duePages} · sources {snapshot.matchingSources}</Text>
          <Text variant="caption" color="textSecondary">Receipts {snapshot.receipts} · graph nodes {snapshot.graphNodes} · edges {snapshot.graphEdges}</Text>
          <Text variant="caption" color="textSecondary">Topic truncations {snapshot.topicTruncations}</Text>
          <Text variant="caption" color="textSecondary">Belief {snapshot.maintenance} · generation {snapshot.processedGeneration}/{snapshot.sourceGeneration}</Text>
          <Text variant="caption" color="textSecondary">Graph pending: belief {snapshot.graphPending ? 'yes' : 'no'} · merge {snapshot.mergeGraphPending ? 'yes' : 'no'}</Text>
        </View>
      )}
      {!!message && <Text variant="caption" color="textSecondary" style={styles.line}>{message}</Text>}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    buttons: { marginTop: t.spacing.md, gap: t.spacing.sm },
    readout: { marginTop: t.spacing.md, gap: t.spacing.xs },
    line: { marginTop: t.spacing.xs },
  })
