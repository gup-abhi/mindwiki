import { generateCheckinQuestion } from '@/services/llm/deep-model'
import { listPursuits, updatePursuit, type Pursuit } from '@/services/storage/pursuits'

const DAY_MS = 86_400_000
// Weekly-ish cadence, capped at one surfaced check-in per day across all pursuits.
export const CHECKIN_INTERVAL_MS = 7 * DAY_MS
export const CHECKIN_COOLDOWN_MS = DAY_MS
// Active pursuits with no activity for this long are retired to 'dormant' so
// forgotten goals stop surfacing (re-mentioning one starts a fresh pursuit).
export const DORMANT_AFTER_MS = 30 * DAY_MS

// A pursuit's most recent activity — a fresh mention or a check-in both reset
// the clock, so we don't nag about something the user just wrote about.
function lastActivity(p: Pursuit): number {
  return Math.max(p.last_mentioned_at, p.last_checkin_at ?? 0)
}

export function dueForCheckin(p: Pursuit, now: number): boolean {
  return p.status === 'active' && now - lastActivity(p) >= CHECKIN_INTERVAL_MS
}

/** An active pursuit gone quiet long enough to retire to 'dormant'. */
export function isStale(p: Pursuit, now: number): boolean {
  return p.status === 'active' && now - lastActivity(p) >= DORMANT_AFTER_MS
}

/**
 * Pick the single pursuit to check in on, or null. Enforces the one-per-day cap
 * (if any pursuit was checked in within the last day, hold off entirely) and
 * otherwise returns the most-overdue active pursuit past the weekly interval.
 * Pure — operates on the supplied list + clock.
 */
export function selectDuePursuit(pursuits: Pursuit[], now: number): Pursuit | null {
  const recentlyChecked = pursuits.some(
    (p) => p.last_checkin_at != null && now - p.last_checkin_at < CHECKIN_COOLDOWN_MS
  )
  if (recentlyChecked) return null

  const due = pursuits.filter((p) => dueForCheckin(p, now))
  if (due.length === 0) return null
  return due.reduce((oldest, p) => (lastActivity(p) < lastActivity(oldest) ? p : oldest))
}

/** Deterministic check-in question used when generation is unavailable. */
export function fallbackCheckinQuestion(title: string): string {
  return `How are things going with ${title}?`
}

/**
 * Resolve the pursuit to surface on the Home check-in card, generating + caching
 * its question the first time it's due. Returns null when nothing is due.
 * Best-effort: on a generation failure it caches a templated question instead,
 * so the card always has something to show. Never throws.
 */
export async function prepareCheckin(now: number = Date.now()): Promise<Pursuit | null> {
  const all = await listPursuits()
  if (!all.success) return null

  // Retire long-silent pursuits, and keep the rest in the running for selection.
  const live: Pursuit[] = []
  for (const p of all.data) {
    if (isStale(p, now)) void updatePursuit(p.id, { status: 'dormant' })
    else live.push(p)
  }

  const due = selectDuePursuit(live, now)
  if (!due) return null
  if (due.checkin_question.trim()) return due // already prepared

  const gen = await generateCheckinQuestion({ title: due.title, details: due.details })
  const question = gen.success ? gen.data : fallbackCheckinQuestion(due.title)
  const updated = await updatePursuit(due.id, { checkin_question: question })
  return updated.success ? updated.data : { ...due, checkin_question: question }
}
