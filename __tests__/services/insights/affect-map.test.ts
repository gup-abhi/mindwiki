import { computeAffectMap } from '@/services/insights/affect-map'
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
  energy: 3,
  distortion: null,
  mood_score: null,
  topic: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  source: 'journal',
  ...over,
})

const many = (n: number, over: Partial<Entry> = {}): Entry[] => Array.from({ length: n }, () => base(over))

describe('computeAffectMap', () => {
  it('returns null below the minimum sample size', () => {
    expect(computeAffectMap(many(7, { mood: 4, energy: 2 }), now)).toBeNull()
  })

  it('excludes entries with no energy value (and they do not count toward the minimum)', () => {
    // 8 entries but only 4 carry energy → below the minimum → null.
    const withEnergy = many(4, { mood: 4, energy: 2 })
    const withoutEnergy = many(4, { mood: 4, energy: null })
    expect(computeAffectMap([...withEnergy, ...withoutEnergy], now)).toBeNull()
  })

  it('excludes entries older than the 8-week window', () => {
    const recent = many(8, { mood: 4, energy: 2 })
    const old = many(8, { mood: 1, energy: 5, created_at: now - 60 * DAY })
    const map = computeAffectMap([...recent, ...old], now)
    expect(map?.total).toBe(8) // only the recent ones
  })

  it('bins counts into the right cells and tracks the max', () => {
    const map = computeAffectMap(
      [...many(5, { mood: 5, energy: 1 }), ...many(3, { mood: 1, energy: 5 })],
      now
    )
    expect(map?.total).toBe(8)
    expect(map?.cells).toHaveLength(25)
    expect(map?.cells.find((c) => c.pleasantness === 5 && c.energy === 1)?.count).toBe(5)
    expect(map?.cells.find((c) => c.pleasantness === 1 && c.energy === 5)?.count).toBe(3)
    expect(map?.max).toBe(5)
  })

  it('names the dominant quadrant (calm = pleasant + low energy)', () => {
    const map = computeAffectMap(many(8, { mood: 5, energy: 1 }), now)
    expect(map?.dominant).toBe('pleasantLow')
    expect(map?.summary).toContain('calm')
  })

  it('names the tense quadrant (unpleasant + high energy)', () => {
    const map = computeAffectMap(many(8, { mood: 1, energy: 5 }), now)
    expect(map?.dominant).toBe('unpleasantHigh')
    expect(map?.summary).toContain('tense')
  })
})
