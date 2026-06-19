/**
 * On-device timing intelligence: a 24-slot histogram of when the user is
 * active (app opens / entries), used to pick the reminder send hour. Pure —
 * the histogram is persisted by the caller (settings table); nothing here
 * touches storage or the network.
 */
export type HourHistogram = number[] // length 24, index = local hour

/** Sensible default until enough data accrues: 8pm. */
export const DEFAULT_SEND_HOUR = 20

// Reminders are an evening nudge to reflect on the day, so the send hour is
// constrained to this window (inclusive) — never the small hours, even for a
// night-owl whose raw activity peaks after midnight.
export const REMINDER_WINDOW_START = 17 // 5pm
export const REMINDER_WINDOW_END = 21 // 9pm

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
 * The hour to send the evening reminder: the user's most-active hour *within the
 * evening window* (earliest on a tie). Falls back to DEFAULT_SEND_HOUR until at
 * least `minSamples` evening activities accrue — so a night-owl (or a user with
 * little evening data) gets a sane 8pm nudge rather than an after-midnight one.
 */
export function reminderHour(
  histogram: HourHistogram,
  fallback = DEFAULT_SEND_HOUR,
  minSamples = 3
): number {
  let eveningTotal = 0
  let bestCount = 0
  let bestHour = fallback
  for (let h = REMINDER_WINDOW_START; h <= REMINDER_WINDOW_END; h++) {
    const count = histogram[h] ?? 0
    eveningTotal += count
    if (count > bestCount) {
      bestCount = count
      bestHour = h
    }
  }
  return eveningTotal < minSamples ? fallback : bestHour
}
