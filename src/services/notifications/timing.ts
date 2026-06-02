/**
 * On-device timing intelligence: a 24-slot histogram of when the user is
 * active (app opens / entries), used to pick the reminder send hour. Pure —
 * the histogram is persisted by the caller (settings table); nothing here
 * touches storage or the network.
 */
export type HourHistogram = number[] // length 24, index = local hour

/** Sensible default until enough data accrues: 8pm. */
export const DEFAULT_SEND_HOUR = 20

export function emptyHistogram(): HourHistogram {
  return new Array(24).fill(0)
}

/** Record an activity timestamp into a (copied) histogram by its local hour. */
export function recordActivity(histogram: HourHistogram, ts: number): HourHistogram {
  const hour = new Date(ts).getHours()
  const next = histogram.slice()
  next[hour] = (next[hour] ?? 0) + 1
  return next
}

/**
 * Peak active hour (earliest on a tie). Falls back to DEFAULT_SEND_HOUR until
 * at least `minSamples` activities are recorded, so a single early data point
 * can't pin the reminder to an odd hour.
 */
export function optimalHour(
  histogram: HourHistogram,
  fallback = DEFAULT_SEND_HOUR,
  minSamples = 3
): number {
  const total = histogram.reduce((a, b) => a + b, 0)
  if (total < minSamples) return fallback

  let bestCount = -1
  let bestHour = fallback
  for (let h = 0; h < 24; h++) {
    if ((histogram[h] ?? 0) > bestCount) {
      bestCount = histogram[h] ?? 0
      bestHour = h
    }
  }
  return bestHour
}
