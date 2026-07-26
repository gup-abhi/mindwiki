import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

interface Check {
  id: string
  label: string
  detail: string
}

const CHECKS: Check[] = [
  {
    id: 'V1',
    label: 'Map renders, ≥30 fps pan/zoom',
    detail: 'You tab → Map. WebView paints, gesture interactions smooth.',
  },
  {
    id: 'V2',
    label: 'Attack label does not break out of <script>',
    detail:
      'Add entry topic = "</script><img src=x onerror=alert(1)>". Open Map. No alert fires, label visible as text, focus → node → entry list shows the malicious topic.',
  },
  {
    id: 'V3',
    label: 'Dismiss/restore round-trips across devices',
    detail: 'Drop node A on phone 1. After sync, A disappears on phone 2. Restore on phone 2 → after sync, A returns on phone 1.',
  },
  {
    id: 'V4',
    label: 'Cross-type resurrection (product intent)',
    detail: 'Dismiss place:work. New entry tagged Work → situation:Work node appears (dismissal is exact by (type,label)).',
  },
  {
    id: 'V5',
    label: '1500-node graph opens <1.5s, smooth pan',
    detail: 'Seed ≥1500 nodes; open Map; first paint <1.5s; pan stays smooth; label cap (≤250) holds.',
  },
  {
    id: 'V6',
    label: 'WebView navigation blocked',
    detail: 'Long-press / triple-tap in WebView: no navigation, no console error. originWhitelist + onShouldStartLoadWithRequest hold.',
  },
  {
    id: 'V7',
    label: 'Restore is atomic (no half-state on crash)',
    detail: 'Simulator: kill -9 mid-restore. Relaunch: graph state matches either pre-restore with flag set or pre-restore with flag cleared — never half-restored.',
  },
]

/**
 * Dev-only checklist for the graph/map device-verification matrix (V1–V7).
 * Tap a row to toggle done/not-done for the current session. Persists nothing;
 * closing the modal resets. Wired into Settings under __DEV__.
 */
export function DevGraphAudit() {
  const styles = useThemedStyles(makeStyles)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<Set<string>>(() => new Set())

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const completed = done.size
  const total = CHECKS.length

  return (
    <Card variant="sunken">
      <Text variant="bodyStrong">Graph audit verification matrix</Text>
      <Text variant="caption" color="textSecondary" style={styles.hint}>
        {`V1–V7 device checks for the recent graph/map remediation. ${completed}/${total} done this session.`}
      </Text>
      <View style={styles.action}>
        <Button
          title={open ? 'Hide matrix' : 'Show matrix'}
          variant="secondary"
          fullWidth
          onPress={() => setOpen((v) => !v)}
          testID="dev-graph-audit-toggle"
        />
      </View>
      {open && (
        <Modal visible animationType="slide" onRequestClose={() => setOpen(false)} testID="dev-graph-audit-modal">
          <View style={styles.modal} testID="dev-graph-audit-root">
            <Text variant="title" style={styles.modalTitle}>
              Graph audit · V1–V7
            </Text>
            <ScrollView contentContainerStyle={styles.list}>
              {CHECKS.map((c) => {
                const isDone = done.has(c.id)
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => toggle(c.id)}
                    style={[styles.row, isDone && styles.rowDone]}
                    testID={`dev-graph-audit-row-${c.id}`}
                  >
                    <Text variant="bodyStrong" style={styles.id}>
                      {c.id}
                    </Text>
                    <View style={styles.rowBody}>
                      <Text variant="bodyStrong">{c.label}</Text>
                      <Text variant="caption" color="textSecondary" style={styles.detail}>
                        {c.detail}
                      </Text>
                    </View>
                    <Text
                      variant="bodyStrong"
                      color={isDone ? 'success' : 'textMuted'}
                      style={styles.mark}
                    >
                      {isDone ? '✓' : '·'}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
            <View style={styles.close}>
              <Button
                title="Close"
                variant="secondary"
                fullWidth
                onPress={() => setOpen(false)}
                testID="dev-graph-audit-close"
              />
            </View>
          </View>
        </Modal>
      )}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    hint: { marginTop: t.spacing.xs },
    action: { marginTop: t.spacing.md },
    modal: { flex: 1, padding: t.spacing.lg, backgroundColor: t.colors.bg },
    modalTitle: { marginBottom: t.spacing.md },
    list: { paddingBottom: t.spacing.xl },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: t.spacing.md,
      marginBottom: t.spacing.sm,
      borderRadius: t.radii.md,
      backgroundColor: t.colors.surfaceAlt,
      gap: t.spacing.md,
    },
    rowDone: { opacity: 0.85 },
    id: { width: 32 },
    rowBody: { flex: 1 },
    detail: { marginTop: t.spacing.xs },
    mark: { width: 24, textAlign: 'center' },
    close: { paddingTop: t.spacing.md },
  })