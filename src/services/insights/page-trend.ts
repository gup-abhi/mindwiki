import {
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopic,
  listEntriesForEntity,
  type Entry,
} from '@/services/storage/entries'
import { type EntityType } from '@/services/storage/entities'
import { type Result, ok } from '@/types/result'

// How a single concept (one wiki page) has moved over recent weeks — frequency
// and the mood on the days it appears. Pure aggregation from entry tags, so it's
// immune to wiki-page drift. Observational only, never clinical.

const WEEK_MS = 7 * 86_400_000

// 8-week window split into two 4-week halves — mirrors detectMomentum so the two
// "how you're changing" lenses stay consistent.
const LOOKBACK_WEEKS = 8
const HALF_MS = 4 * WEEK_MS
const MIN_TOTAL = 4 // fewer entries in the window than this: no trend to read
const MIN_HALF = 2 // each half needs real data before we compare directions
// Frequency is a SHARE of all journaling in each half, not a raw count, so a week
// you simply wrote more/less can't masquerade as the concept rising/falling.
const SHARE_MARGIN = 0.1 // ≥10 percentage-point shift in that share …
const SHARE_RATIO = 1.5 // … and a real relative move — both required.
const MOOD_MARGIN = 0.4 // 1–5 scale, matches detectMomentum's MOOD_RISE.

export interface TrendWeek {
  /** Local ms timestamp of the week's start (oldest first). */
  weekStart: number
  count: number
  /** Mean mood (1–5) of that week's entries, or null if none. */
  avgMood: number | null
}

export type FrequencyDirection = 'rising' | 'falling' | 'steady'
export type MoodDirection = 'lifting' | 'dipping' | 'steady'

export interface PageTrend {
  /** Entries carrying this concept within the 8-week window. */
  totalEntries: number
  /** Per-week frequency series for the sparkline. */
  weeks: TrendWeek[]
  frequencyDirection: FrequencyDirection
  moodDirection: MoodDirection
  /** Observational one-liner naming only what genuinely moved; null when nothing did. */
  message: string | null
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * How one concept has changed over the last 8 weeks. `conceptEntries` are the
 * journal entries carrying it; `allEntries` is every journal entry (the
 * denominator that makes frequency a volume-robust share). Returns null when
 * there's too little in the window to say anything honest. Pure — no IO.
 */
export function computePageTrend(
  conceptEntries: Entry[],
  allEntries: Entry[],
  now: number,
  title: string
): PageTrend | null {
  const start = now - LOOKBACK_WEEKS * WEEK_MS
  const inWindow = conceptEntries.filter((e) => e.created_at >= start && e.created_at <= now)
  if (inWindow.length < MIN_TOTAL) return null

  // Weekly buckets (oldest first) for the sparkline. The final bucket runs to
  // `now` inclusive so a just-created entry isn't dropped on the boundary.
  const weeks: TrendWeek[] = []
  for (let i = 0; i < LOOKBACK_WEEKS; i++) {
    const ws = start + i * WEEK_MS
    const we = i === LOOKBACK_WEEKS - 1 ? now + 1 : ws + WEEK_MS
    const bucket = inWindow.filter((e) => e.created_at >= ws && e.created_at < we)
    weeks.push({
      weekStart: ws,
      count: bucket.length,
      avgMood: bucket.length ? mean(bucket.map((e) => e.mood)) : null,
    })
  }

  const mid = now - HALF_MS
  const cEarlier = inWindow.filter((e) => e.created_at < mid)
  const cRecent = inWindow.filter((e) => e.created_at >= mid)
  const totEarlier = allEntries.filter((e) => e.created_at >= start && e.created_at < mid).length
  const totRecent = allEntries.filter((e) => e.created_at >= mid && e.created_at <= now).length

  // Frequency direction, as a share of all journaling in each half.
  let frequencyDirection: FrequencyDirection = 'steady'
  const emerging = cEarlier.length === 0 && cRecent.length >= MIN_TOTAL
  if (emerging) {
    frequencyDirection = 'rising'
  } else if (cEarlier.length >= MIN_HALF && cRecent.length >= MIN_HALF && totEarlier > 0 && totRecent > 0) {
    const shareEarlier = cEarlier.length / totEarlier
    const shareRecent = cRecent.length / totRecent
    if (shareRecent - shareEarlier >= SHARE_MARGIN && shareRecent / shareEarlier >= SHARE_RATIO) {
      frequencyDirection = 'rising'
    } else if (
      shareEarlier - shareRecent >= SHARE_MARGIN &&
      shareRecent > 0 &&
      shareEarlier / shareRecent >= SHARE_RATIO
    ) {
      frequencyDirection = 'falling'
    }
  }

  // Mood shift on this concept's own days.
  let moodDirection: MoodDirection = 'steady'
  if (cEarlier.length >= MIN_HALF && cRecent.length >= MIN_HALF) {
    const d = mean(cRecent.map((e) => e.mood)) - mean(cEarlier.map((e) => e.mood))
    if (d >= MOOD_MARGIN) moodDirection = 'lifting'
    else if (-d >= MOOD_MARGIN) moodDirection = 'dipping'
  }

  return {
    totalEntries: inWindow.length,
    weeks,
    frequencyDirection,
    moodDirection,
    message: buildMessage(title, frequencyDirection, moodDirection, emerging),
  }
}

/**
 * Observational one-liner naming only what actually moved — never a vague "you're
 * changing", never a diagnosis, never a good/bad verdict (a falling distortion
 * reads the same neutral way as a rising one; the reader interprets).
 */
function buildMessage(
  title: string,
  freq: FrequencyDirection,
  mood: MoodDirection,
  emerging: boolean
): string | null {
  const freqPart = emerging
    ? `${title} has started coming up in your entries this past month`
    : freq === 'rising'
      ? `${title} has been coming up more often lately`
      : freq === 'falling'
        ? `${title} has been coming up less often than it did a month ago`
        : null
  const moodTail =
    mood === 'lifting'
      ? 'the days it shows up have felt a little brighter'
      : mood === 'dipping'
        ? 'the days it shows up have felt heavier'
        : null

  if (freqPart && moodTail) return `${freqPart}, and ${moodTail}.`
  if (freqPart) return `${freqPart}.`
  // Frequency held steady but the mood on those days moved — still worth naming.
  if (moodTail) return `${title} comes up about as often, but ${moodTail} lately.`
  return null
}

/** A wiki page paired with its (non-null) trend, for the Trends "what's changing" list. */
export interface PageTrendEntry {
  page: { id: string; title: string; category: string | null }
  trend: PageTrend
}

/** Minimal page shape the rollup needs (WikiPage is structurally assignable). */
type TrendablePage = { id: string; title: string; category: string | null }

/**
 * Trends for many pages at once, keeping only those with a genuine, nameable
 * movement (a message) — a page with data but no real shift is left out so the
 * Trends list stays a list of things that actually changed. Strongest-first: more
 * signals moved, then more entries behind it. `load` is injectable for tests.
 */
export async function computeTrendingPages(
  pages: readonly TrendablePage[],
  allEntries: Entry[],
  now: number,
  load: (category: string | null, title: string) => Promise<Result<Entry[]>> = loadConceptEntries
): Promise<PageTrendEntry[]> {
  const out: PageTrendEntry[] = []
  for (const p of pages) {
    const res = await load(p.category, p.title)
    if (!res.success) continue
    const trend = computePageTrend(res.data, allEntries, now, p.title)
    if (trend && trend.message) {
      out.push({ page: { id: p.id, title: p.title, category: p.category }, trend })
    }
  }
  const moved = (t: PageTrend): number =>
    (t.frequencyDirection !== 'steady' ? 1 : 0) + (t.moodDirection !== 'steady' ? 1 : 0)
  return out.sort((a, b) => moved(b.trend) - moved(a.trend) || b.trend.totalEntries - a.trend.totalEntries)
}

const ENTITY_TYPES: readonly string[] = ['person', 'place', 'activity', 'belief', 'behavior']

/**
 * Fetch the journal entries behind a wiki page, dispatched by its category. The
 * IO half of the trend (kept out of computePageTrend so the math stays pure).
 * Unknown/null categories have no source query → empty (no trend).
 */
export function loadConceptEntries(category: string | null, title: string): Promise<Result<Entry[]>> {
  switch (category) {
    case 'emotion':
      return listEntriesByEmotion(title)
    case 'distortion':
      return listEntriesByDistortion(title)
    case 'theme':
      return listEntriesByTopic(title)
    default:
      return category && ENTITY_TYPES.includes(category)
        ? listEntriesForEntity(category as EntityType, title)
        : Promise.resolve(ok([]))
  }
}
