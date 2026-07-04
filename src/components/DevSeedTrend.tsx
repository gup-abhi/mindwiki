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
  /** 1–5 energy, so this also populates the affect map. */
  energy: number
  emotion: string
  /** Canonical CBT distortion, or 'none'. Drives the thinking-patterns trend. */
  distortion: string
}

// Anxiety: 9 entries in the earlier half (mood 2), 3 in the recent half (mood 4).
// High energy → the earlier ones land "tense", the recent ones "upbeat". The
// earlier ones also carry distortions (dense) and the recent ones mostly don't
// (sparse) → a falling distortion rate. Window-wide the ranking is
// Catastrophizing (5) > Mind reading (3) > Should statements (2).
const ANXIETY: E[] = [
  ...(
    [
      [30, 'Catastrophizing'],
      [33, 'Catastrophizing'],
      [36, 'Catastrophizing'],
      [40, 'Catastrophizing'],
      [43, 'Mind reading'],
      [47, 'Mind reading'],
      [50, 'Mind reading'],
      [52, 'Should statements'],
      [54, 'Should statements'],
    ] as const
  ).map(([day, distortion]) => ({ day, mood: 2, energy: 4, emotion: 'Anxiety', distortion })),
  ...(
    [
      [5, 'Catastrophizing'],
      [14, 'none'],
      [23, 'none'],
    ] as const
  ).map(([day, distortion]) => ({ day, mood: 4, energy: 4, emotion: 'Anxiety', distortion })),
]
// Filler (a different feeling) so Anxiety's SHARE of journaling drops: 3 earlier,
// 9 recent → earlier share 9/12 = 0.75, recent share 3/12 = 0.25. Pleasant + low
// energy → these land in the "calm" corner of the affect map.
const FILLER: E[] = [
  ...[31, 44, 53].map((day) => ({ day, mood: 4, energy: 2, emotion: 'Calm', distortion: 'none' })),
  ...[1, 3, 6, 9, 12, 16, 19, 22, 26].map((day) => ({ day, mood: 4, energy: 2, emotion: 'Calm', distortion: 'none' })),
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
        // Spread across morning/afternoon/evening so the mood-by-day-and-time
        // heatmap populates all three rows (hour is independent of the trend).
        const ts = new Date(now - e.day * DAY)
        ts.setHours([9, 14, 20][i % 3], 0, 0, 0)
        await tx.execute(
          `INSERT INTO entries
             (id, created_at, mood, energy, situation, thought, behavior, closing_note,
              emotion, named_emotion, distortion, mood_score, topic, tagged_at,
              wiki_indexed_at, graph_indexed_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `seed-trend-${i}`,
            ts.getTime(),
            e.mood,
            e.energy,
            'seeded entry',
            '',
            null,
            null,
            e.emotion,
            null,
            e.distortion,
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
        “How this has changed” trend fires — plus energy for the affect map and distortions
        (dense earlier) for the Thinking-patterns trend.
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
