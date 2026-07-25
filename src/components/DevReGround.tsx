import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { getDb } from '@/services/storage/db'
import { listPages, regeneratePageContent } from '@/services/storage/wiki'
import { synthesizePageReGround } from '@/services/llm/deep-model'
import {
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopicOrTopic2,
  listEntriesForEntity,
} from '@/services/storage/entries'
import type { EntityType } from '@/services/storage/entities'
import { useSyncStore } from '@/store/sync.store'

/**
 * Dev-only: re-ground every wiki page that has 10+ entries but has never been
 * re-grounded. Rated buttons: "Dry run" (counts candidates), "Run" (re-grounds
 * all). Only rendered under __DEV__.
 */

const DAY = 86_400_000

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
      const eligible = pages.data.filter((p) => p.entry_count >= 10)
      if (eligible.length === 0) {
        append('No pages with 10+ entries found.')
      } else {
        append(`${eligible.length} page(s) eligible:`)
        for (const p of eligible) {
          append(`  "${p.title}" (${p.entry_count} entries)`)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    setLog([])
    const db = getDb()
    try {
      const pages = await listPages(db)
      if (!pages.success) { append('Failed to list pages'); return }
      const eligible = pages.data.filter((p) => p.entry_count >= 10 && !p.dismissed_at)
      if (eligible.length === 0) { append('No eligible pages.'); return }

      append(`Re-grounding ${eligible.length} page(s)…`)

      // Reusable entry sampler — mirrors engine.ts's sampleEntriesForPage
      async function sample(title: string, category: string | null, max: number) {
        const entityTypes = ['person','place','activity','belief','behavior']
        const isEntity = entityTypes.includes(category ?? '')
        const entityType = isEntity ? category as EntityType : null
        const res = entityType
          ? await listEntriesForEntity(entityType, title)
          : category === 'theme'
            ? await listEntriesByTopicOrTopic2(title)
            : category === 'distortion'
              ? await listEntriesByDistortion(title)
              : await listEntriesByEmotion(title)
        return res.success ? res.data.slice(0, max) : []
      }

      let ok = 0, fail = 0
      for (const page of eligible) {
        const past = await sample(page.title, page.category, 6)
        if (past.length === 0) {
          append(`  ✕ "${page.title}" — no source entries (skipping)`)
          fail++
          continue
        }
        const synth = await synthesizePageReGround({
          title: page.title,
          category: page.category,
          existingContent: page.content,
          situation: past[0].situation,
          thought: past[0].thought,
          pastEntries: past.map((e) => ({
            situation: e.situation,
            thought: e.thought,
            created_at: e.created_at,
          })),
        })
        if (!synth.success) {
          append(`  ✕ "${page.title}" — synth failed (${synth.error.code})`)
          fail++
          continue
        }
        const applied = await regeneratePageContent(page.id, synth.data, db)
        if (!applied.success) {
          append(`  ✕ "${page.title}" — regenerate failed (${applied.error.code})`)
          fail++
          continue
        }
        append(`  ✓ "${page.title}" re-grounded (v${applied.data.version})`)
        ok++
      }
      useSyncStore.getState().bumpRevision()
      append(`Done — ${ok} succeeded, ${fail} failed`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Re-ground wiki pages with 10+ entries but no prior re-grounding.
        This samples source entries and re-synthesises each page from scratch.
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
