import { computeDistortionTrend } from '@/services/insights/distortion-trend'
import { type Entry } from '@/services/storage/entries'

const DAY = 86_400_000
const now = new Date(2026, 5, 15, 12).getTime()

const base = (over: Partial<Entry> = {}): Entry => ({
  id: Math.random().toString(),
  created_at: now - DAY,
  mood: 3,
  situation: '',
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: 'none', // tagged, no distortion, unless overridden
  mood_score: null,
  topic: null,
  tagged_at: now,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  source: 'journal',
  ...over,
})

/** n tagged entries `daysAgo`, `distorted` of them carrying `name`. */
const cluster = (n: number, daysAgo: number, distorted: number, name = 'Catastrophizing'): Entry[] =>
  Array.from({ length: n }, (_, i) =>
    base({ created_at: now - daysAgo * DAY, distortion: i < distorted ? name : 'none' })
  )

describe('computeDistortionTrend', () => {
  it('returns null below the minimum tagged sample size', () => {
    // 7 tagged entries, some distorted, still below MIN_TAGGED (8).
    expect(computeDistortionTrend(cluster(7, 10, 4), now)).toBeNull()
  })

  it('does not count untagged entries toward the sample', () => {
    // 8 rows but 4 are untagged (distortion null) → only 4 tagged → null.
    const tagged = cluster(4, 10, 2)
    const untagged = Array.from({ length: 4 }, () => base({ distortion: null }))
    expect(computeDistortionTrend([...tagged, ...untagged], now)).toBeNull()
  })

  it('returns null when no entry carries a real distortion', () => {
    // 12 tagged, all 'none' → nothing to trend.
    expect(computeDistortionTrend(cluster(12, 10, 0), now)).toBeNull()
  })

  it('ignores entries outside the 8-week window', () => {
    const old = cluster(12, 70, 6) // 10 weeks ago
    expect(computeDistortionTrend(old, now)).toBeNull()
  })

  it('reports a falling direction when the recent distortion rate drops', () => {
    // Earlier half (weeks 5-8): 8 tagged, 6 distorted → 0.75.
    // Recent half (weeks 1-4): 8 tagged, 1 distorted → 0.125.
    const earlier = cluster(8, 45, 6)
    const recent = cluster(8, 10, 1)
    const trend = computeDistortionTrend([...earlier, ...recent], now)
    expect(trend?.direction).toBe('falling')
    expect(trend?.message).toMatch(/less often/)
  })

  it('reports a rising direction when the recent distortion rate climbs', () => {
    const earlier = cluster(8, 45, 1)
    const recent = cluster(8, 10, 6)
    const trend = computeDistortionTrend([...earlier, ...recent], now)
    expect(trend?.direction).toBe('rising')
    expect(trend?.message).toMatch(/more often/)
  })

  it('reports steady (no message) when the rate barely moves', () => {
    const earlier = cluster(8, 45, 3)
    const recent = cluster(8, 10, 3)
    const trend = computeDistortionTrend([...earlier, ...recent], now)
    expect(trend?.direction).toBe('steady')
    expect(trend?.message).toBeNull()
  })

  it('ranks the most common distortions strongest-first, capped at three', () => {
    const entries = [
      ...cluster(6, 20, 5, 'Catastrophizing'),
      ...cluster(4, 25, 3, 'Mind reading'),
      ...cluster(3, 30, 2, 'Should statements'),
      ...cluster(2, 35, 1, 'Labeling'),
    ]
    const trend = computeDistortionTrend(entries, now)
    expect(trend?.top.map((t) => t.name)).toEqual(['Catastrophizing', 'Mind reading', 'Should statements'])
    expect(trend?.top[0].count).toBe(5)
  })

  it('produces a rate series over eight weekly buckets', () => {
    const trend = computeDistortionTrend(cluster(12, 20, 6), now)
    expect(trend?.weeks).toHaveLength(8)
    // Every week with tagged entries has a numeric rate; empty weeks are null.
    for (const w of trend?.weeks ?? []) {
      if (w.tagged === 0) expect(w.rate).toBeNull()
      else expect(w.rate).toBeCloseTo(w.distorted / w.tagged)
    }
  })
})
