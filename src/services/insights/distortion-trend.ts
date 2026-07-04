import { type Entry } from '@/services/storage/entries'

// How often cognitive distortions show up in tagged entries, trending over the
// last 8 weeks. Pure aggregation from the `distortion` tag — no wiki-page drift,
// no IO. CBT-aligned: a distortion is a recognised thinking-error, so unlike a
// mood or a topic this trend carries a gentle direction (fewer = the direction
// therapy aims for). Copy stays observational and never claims progress as an
// outcome — "come up less often", not "you're getting better".

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const LOOKBACK_WEEKS = 8
const HALF_MS = 4 * WEEK_MS

// Denominator is TAGGED entries (the model actually evaluated them for a
// distortion), so the rate is "of the entries we looked at, how many carried a
// distortion" — robust to journaling volume, the same share-not-count choice
// page-trend makes.
const MIN_TAGGED = 8 // too few evaluated entries in the window: no trend to read
const MIN_DISTORTED = 2 // need at least a couple to rank / have a pattern at all
const MIN_HALF_TAGGED = 3 // each half needs real data before comparing rates
const RATE_MARGIN = 0.1 // ≥10 percentage-point shift in the distortion rate …
const RATE_RATIO = 1.5 // … and a real relative move — both required.
const TOP_N = 3

/** An entry was evaluated for distortions iff its `distortion` tag is set. */
const isTagged = (e: Entry): e is Entry & { distortion: string } => e.distortion != null
/** 'none' is the tagged-but-no-distortion value; anything else is a real one. */
const isDistorted = (e: Entry): boolean => e.distortion != null && e.distortion !== 'none'

export interface DistortionWeek {
  /** Local ms timestamp of the week's start (oldest first). */
  weekStart: number
  tagged: number
  distorted: number
  /** distorted / tagged (0..1), or null when nothing was tagged that week. */
  rate: number | null
}

export interface DistortionCount {
  /** Canonical CBT distortion name. */
  name: string
  count: number
}

export type DistortionDirection = 'rising' | 'falling' | 'steady'

export interface DistortionTrend {
  /** Tagged (evaluated) entries in the window — the rate's denominator. */
  totalTagged: number
  /** Entries carrying a real distortion in the window. */
  totalDistorted: number
  /** Per-week rate series for the sparkline (oldest first). */
  weeks: DistortionWeek[]
  direction: DistortionDirection
  /** The most common distortions in the window, strongest first (≤ TOP_N). */
  top: DistortionCount[]
  /** Observational one-liner, or null when the rate held steady. */
  message: string | null
}

/**
 * The distortion-frequency trend over the last 8 weeks, or null when there's too
 * little tagged history to say anything honest. Pure — no IO.
 */
export function computeDistortionTrend(entries: Entry[], now: number): DistortionTrend | null {
  const start = now - LOOKBACK_WEEKS * WEEK_MS
  const inWindow = entries.filter((e) => e.created_at >= start && e.created_at <= now && isTagged(e))
  const distorted = inWindow.filter(isDistorted)
  if (inWindow.length < MIN_TAGGED || distorted.length < MIN_DISTORTED) return null

  // Weekly buckets (oldest first). The final bucket runs to `now` inclusive so a
  // just-tagged entry isn't dropped on the boundary.
  const weeks: DistortionWeek[] = []
  for (let i = 0; i < LOOKBACK_WEEKS; i++) {
    const ws = start + i * WEEK_MS
    const we = i === LOOKBACK_WEEKS - 1 ? now + 1 : ws + WEEK_MS
    const bucket = inWindow.filter((e) => e.created_at >= ws && e.created_at < we)
    const d = bucket.filter(isDistorted).length
    weeks.push({
      weekStart: ws,
      tagged: bucket.length,
      distorted: d,
      rate: bucket.length ? d / bucket.length : null,
    })
  }

  // Two-halves rate comparison for the direction.
  const mid = now - HALF_MS
  const taggedEarlier = inWindow.filter((e) => e.created_at < mid)
  const taggedRecent = inWindow.filter((e) => e.created_at >= mid)
  const direction = directionOf(
    taggedEarlier.length,
    taggedEarlier.filter(isDistorted).length,
    taggedRecent.length,
    taggedRecent.filter(isDistorted).length
  )

  // Rank the distortions in the window by how often they show up.
  const counts = new Map<string, number>()
  for (const e of distorted) counts.set(e.distortion as string, (counts.get(e.distortion as string) ?? 0) + 1)
  const top = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_N)

  return {
    totalTagged: inWindow.length,
    totalDistorted: distorted.length,
    weeks,
    direction,
    top,
    message: messageFor(direction),
  }
}

function directionOf(
  taggedEarlier: number,
  distortedEarlier: number,
  taggedRecent: number,
  distortedRecent: number
): DistortionDirection {
  if (taggedEarlier < MIN_HALF_TAGGED || taggedRecent < MIN_HALF_TAGGED) return 'steady'
  const shareEarlier = distortedEarlier / taggedEarlier
  const shareRecent = distortedRecent / taggedRecent
  if (shareEarlier - shareRecent >= RATE_MARGIN && (shareRecent === 0 || shareEarlier / shareRecent >= RATE_RATIO)) {
    return 'falling'
  }
  if (shareRecent - shareEarlier >= RATE_MARGIN && (shareEarlier === 0 || shareRecent / shareEarlier >= RATE_RATIO)) {
    return 'rising'
  }
  return 'steady'
}

/**
 * Observational one-liner. Never a verdict or an outcome claim — a falling rate
 * is stated as plainly as a rising one; the reader draws the meaning. Steady
 * returns null (the bars + ranking still render, just without a caption).
 */
function messageFor(direction: DistortionDirection): string | null {
  switch (direction) {
    case 'falling':
      return 'Distorted-thinking patterns have come up less often than they did a month ago.'
    case 'rising':
      return 'Distorted-thinking patterns have come up more often lately.'
    case 'steady':
      return null
  }
}
