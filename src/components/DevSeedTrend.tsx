import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { getDb } from '@/services/storage/db'
import { useSyncStore } from '@/store/sync.store'

/**
 * Dev-only: seed one wiki page ("Anxiety") plus a backdated 8-week set of entries
 * crafted to fire the per-page trend — Anxiety is DENSE in the earlier 4 weeks and
 * SPARSE recently (a falling share of journaling), with a mood lift on the recent
 * days. Opening the Anxiety page then shows:
 *   "Anxiety has been coming up less often than it did a month ago, and the days
 *    it shows up have felt a little brighter."  + the weekly sparkline.
 * Only rendered under __DEV__. All rows use a 'seed-trend-' id prefix so "Clear"
 * removes exactly these. Entries are marked already-indexed so the launch
 * catch-up won't re-synthesize the seeded page.
 */

const DAY = 86_400_000

interface E {
  /** Days ago. */
  day: number
  mood: number
  emotion: string
}

// Anxiety: 9 entries in the earlier half (mood 2), 3 in the recent half (mood 4).
const ANXIETY: E[] = [
  ...[30, 33, 36, 40, 43, 47, 50, 52, 54].map((day) => ({ day, mood: 2, emotion: 'Anxiety' })),
  ...[5, 14, 23].map((day) => ({ day, mood: 4, emotion: 'Anxiety' })),
]
// Filler (a different feeling) so Anxiety's SHARE of journaling drops: 3 earlier,
// 9 recent → earlier share 9/12 = 0.75, recent share 3/12 = 0.25.
const FILLER: E[] = [
  ...[31, 44, 53].map((day) => ({ day, mood: 3, emotion: 'Calm' })),
  ...[1, 3, 6, 9, 12, 16, 19, 22, 26].map((day) => ({ day, mood: 3, emotion: 'Calm' })),
]
const ALL: E[] = [...ANXIETY, ...FILLER]

export function DevSeedTrend() {
  const styles = useThemedStyles(makeStyles)
  const [status, setStatus] = useState<string>('')

  async function seed() {
    const db = getDb()
    const now = Date.now()
    await db.transaction(async (tx) => {
      await tx.execute("DELETE FROM entries WHERE id LIKE 'seed-trend-%'")
      await tx.execute("DELETE FROM wiki_pages WHERE id LIKE 'seed-trend-%'")

      await tx.execute(
        `INSERT INTO wiki_pages
           (id, title, category, content, entry_count, version, version_history, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'seed-trend-page',
          'Anxiety',
          'emotion',
          'You tend to feel anxiety most sharply before things that feel high-stakes, ' +
            'and it often shows up as expecting the worst before you have any real evidence for it.',
          ANXIETY.length,
          1,
          '[]',
          now,
          now,
        ]
      )

      for (let i = 0; i < ALL.length; i++) {
        const e = ALL[i]
        await tx.execute(
          `INSERT INTO entries
             (id, created_at, mood, situation, thought, behavior, closing_note,
              emotion, named_emotion, distortion, mood_score, topic, tagged_at,
              wiki_indexed_at, graph_indexed_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `seed-trend-${i}`,
            now - e.day * DAY,
            e.mood,
            'seeded entry',
            '',
            null,
            null,
            e.emotion,
            null,
            'none',
            null,
            null,
            now,
            now, // wiki_indexed_at — already indexed, so catch-up skips it
            now, // graph_indexed_at
            'journal',
          ]
        )
      }
    })
    useSyncStore.getState().bumpRevision()
    setStatus('Seeded. Open Insights → Anxiety to see the trend.')
  }

  async function clear() {
    await getDb().transaction(async (tx) => {
      await tx.execute("DELETE FROM entries WHERE id LIKE 'seed-trend-%'")
      await tx.execute("DELETE FROM wiki_pages WHERE id LIKE 'seed-trend-%'")
    })
    useSyncStore.getState().bumpRevision()
    setStatus('Cleared seeded trend data.')
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Seeds an “Anxiety” page + 8 weeks of entries (dense earlier, sparse recently) so the
        “How this has changed” trend fires. Open Insights → Anxiety.
      </Text>
      <View style={styles.btns}>
        <Button title="Seed trend data" fullWidth onPress={() => void seed()} testID="dev-seed-trend" />
        <Button title="Clear seeded trend" variant="secondary" fullWidth onPress={() => void clear()} testID="dev-clear-trend" />
      </View>
      {!!status && (
        <Text variant="caption" color="accent" style={styles.status}>
          {status}
        </Text>
      )}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    btns: { marginTop: t.spacing.md, gap: t.spacing.sm },
    status: { marginTop: t.spacing.sm },
  })
