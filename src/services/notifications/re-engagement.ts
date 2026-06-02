const DAY_MS = 86_400_000

function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

export type ReengagementTier = 'none' | 'd3' | 'd7' | 'd30'

export interface Reengagement {
  tier: ReengagementTier
  message: string | null
}

const COPY: Record<Exclude<ReengagementTier, 'none'>, string> = {
  d3: 'It’s been a few days. Even a sentence counts — want to check in?',
  d7: 'A week away. Your journal’s still here whenever you’re ready.',
  d30: 'It’s been a while. No pressure — a fresh start is one entry away.',
}

/**
 * Classify how long the user has been silent since their last entry, into the
 * 3 / 7 / 30-day re-engagement bands. Pure: the scheduler decides when (and
 * once) to actually fire. Returns 'none' when there's no prior entry to lapse
 * from — first-time nudges are the daily reminder's job, not re-engagement.
 */
export function reengagement(lastEntryTs: number | null, now: number): Reengagement {
  if (lastEntryTs === null) return { tier: 'none', message: null }

  const daysSince = dayIndex(now) - dayIndex(lastEntryTs)
  const tier: ReengagementTier =
    daysSince >= 30 ? 'd30' : daysSince >= 7 ? 'd7' : daysSince >= 3 ? 'd3' : 'none'

  return { tier, message: tier === 'none' ? null : COPY[tier] }
}
