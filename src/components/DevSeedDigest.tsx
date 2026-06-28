import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { getDb } from '@/services/storage/db'
import { useSyncStore } from '@/store/sync.store'

/**
 * Dev-only: seed a crafted backdated dataset that triggers every gated digest
 * insight at once, so they can be eyeballed today instead of waiting on the
 * calendar. Only rendered under __DEV__. All rows use a 'seed-' id prefix so
 * "Clear" removes exactly these and nothing the user wrote.
 *
 * The set is tuned so a single open of the weekly digest shows:
 *  - Naming the feeling  (named 'Hopeful' on 3 days the words read 'anxiety')
 *  - A gentler read      (3 days rated low but the language read light)
 *  - Weekly rhythm       ('catastrophizing' on the same weekday+afternoon ×3)
 *  - Forward motion      (recent 4 weeks lift over the prior 4 in mood/tone/depth)
 * "Mood check" is the numeric cousin of Naming the feeling and is intentionally
 * hidden in the UI whenever the latter fires.
 */

const DAY = 86_400_000

interface Seed {
  /** Days ago. */
  day: number
  /** Local hour (sets time-of-day; matters only for the weekly-rhythm slot). */
  hour?: number
  mood: number
  score: number | null
  named?: string | null
  emotion?: string | null
  distortion?: string
  /** Fill the optional CBT steps — the momentum "depth" signal. */
  depth?: boolean
}

// Current week (≥7 entries in the trailing 7 days → the digest exists).
const CURRENT_WEEK: Seed[] = [
  { day: 0, mood: 4, score: 0.2, named: 'Hopeful', emotion: 'anxiety' }, // disguise ×3
  { day: 1, mood: 4, score: 0.2, named: 'Hopeful', emotion: 'anxiety' },
  { day: 2, mood: 4, score: 0.2, named: 'Hopeful', emotion: 'anxiety' },
  { day: 3, mood: 1, score: 0.8, named: 'Sad', emotion: 'sadness' }, // gentler read ×3
  { day: 4, mood: 1, score: 0.8, named: 'Sad', emotion: 'sadness' },
  { day: 5, mood: 1, score: 0.8, named: 'Sad', emotion: 'sadness' },
  { day: 6, mood: 4, score: 0.7, named: 'Calm', emotion: 'calm' }, // filler → 7
]

// Recent 4-week half (outside the current week) — high + reflective, for momentum,
// and the weekly-rhythm slot. 7-day spacing keeps the rhythm trio on one weekday.
const RECENT: Seed[] = [
  { day: 10, hour: 14, mood: 5, score: 0.7, distortion: 'catastrophizing', depth: true },
  { day: 17, hour: 14, mood: 5, score: 0.7, distortion: 'catastrophizing', depth: true },
  { day: 24, hour: 14, mood: 5, score: 0.7, distortion: 'catastrophizing', depth: true },
  { day: 9, hour: 12, mood: 5, score: 0.7, distortion: 'mind reading', depth: true }, // weekday spread
  { day: 12, hour: 12, mood: 5, score: 0.7, distortion: 'mind reading', depth: true },
  { day: 14, mood: 5, score: 0.7, depth: true },
  { day: 20, mood: 5, score: 0.7, depth: true },
]

// Earlier 4-week half — low + un-reflected, the baseline momentum rises from.
const EARLIER: Seed[] = [30, 35, 40, 45, 50].map((day) => ({ day, mood: 2, score: 0.4 }))

const ALL_SEEDS = [...CURRENT_WEEK, ...RECENT, ...EARLIER]

function timestampOf(seed: Seed): number {
  const d = new Date(Date.now() - seed.day * DAY)
  if (seed.hour != null) d.setHours(seed.hour, 0, 0, 0)
  return d.getTime()
}

export function DevSeedDigest() {
  const styles = useThemedStyles(makeStyles)
  const [status, setStatus] = useState<string>('')

  async function seed() {
    const db = getDb()
    const now = Date.now()
    await db.transaction(async (tx) => {
      await tx.execute("DELETE FROM entries WHERE id LIKE 'seed-%'") // idempotent re-seed
      for (let i = 0; i < ALL_SEEDS.length; i++) {
        const s = ALL_SEEDS[i]
        await tx.execute(
          `INSERT INTO entries
             (id, created_at, mood, situation, thought, behavior, closing_note,
              emotion, named_emotion, distortion, mood_score, topic, tagged_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `seed-${i}`,
            timestampOf(s),
            s.mood,
            'seeded entry',
            '',
            s.depth ? 'did the thing' : null,
            s.depth ? 'a fairer view' : null,
            s.emotion ?? null,
            s.named ?? null,
            s.distortion ?? 'none',
            s.score,
            null,
            now,
            'journal',
          ]
        )
      }
    })
    useSyncStore.getState().bumpRevision()
    setStatus(`Seeded ${ALL_SEEDS.length} entries. Open the weekly digest.`)
  }

  async function clear() {
    await getDb().execute("DELETE FROM entries WHERE id LIKE 'seed-%'")
    useSyncStore.getState().bumpRevision()
    setStatus('Cleared seeded entries.')
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Seeds a backdated set that fires every gated digest card at once (Naming the feeling,
        A gentler read, Weekly rhythm, Forward motion).
      </Text>
      <View style={styles.btns}>
        <Button title="Seed digest data" fullWidth onPress={() => void seed()} testID="dev-seed-digest" />
        <Button title="Clear seeded entries" variant="secondary" fullWidth onPress={() => void clear()} testID="dev-clear-seed" />
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
