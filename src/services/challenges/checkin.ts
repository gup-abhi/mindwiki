import { type Result, ok, err } from '@/types/result'
import {
  type Challenge,
  type ChallengePatch,
  getChallenge,
  updateChallenge,
} from '@/services/storage/challenges'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { generateAffirmation } from '@/services/llm/deep-model'

import { pickAffirmation } from './affirmations'

const DAY_MS = 86_400_000

/** Local 'YYYY-MM-DD' for a timestamp — the form stored in last_checkin_date. */
export function toLocalDate(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Day index (days since epoch) for a local 'YYYY-MM-DD' string. */
function dayIndexOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** Day index for a timestamp, anchored at its local midnight. */
function dayIndexOfTs(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

export type CheckinOutcome =
  | 'already_done' // today already counted (or challenge already completed)
  | 'first' //        first ever check-in → day 1
  | 'continued' //    checked in yesterday → streak + 1
  | 'reset' //        missed a day → hard reset to day 1

export interface CheckinDecision {
  outcome: CheckinOutcome
  /** The streak after this check-in. */
  streak: number
  /** True when this check-in reaches target_days (challenge complete). */
  justCompleted: boolean
}

/**
 * Pure streak math for a check-in: given the challenge's stored state and the
 * current time, decide the new streak. Same calendar day → no-op; the day after
 * the last check-in → +1; any larger gap → hard reset to day 1 (a missed day
 * breaks the chain — the whole point of a challenge). Never mutates input.
 */
export function evaluateCheckin(challenge: Challenge, now: number): CheckinDecision {
  const current = challenge.current_streak
  if (challenge.status !== 'active') {
    return { outcome: 'already_done', streak: current, justCompleted: false }
  }

  const completes = (streak: number): boolean => streak >= challenge.target_days

  if (challenge.last_checkin_date === '') {
    return { outcome: 'first', streak: 1, justCompleted: completes(1) }
  }

  const diff = dayIndexOfTs(now) - dayIndexOfDate(challenge.last_checkin_date)
  if (diff <= 0) {
    return { outcome: 'already_done', streak: current, justCompleted: false }
  }
  if (diff === 1) {
    const streak = current + 1
    return { outcome: 'continued', streak, justCompleted: completes(streak) }
  }
  return { outcome: 'reset', streak: 1, justCompleted: completes(1) }
}

/**
 * The streak as it should display *now*: the stored streak while the chain is
 * still alive (last check-in today or yesterday), otherwise 0 — a missed day has
 * silently broken it even though no tap has happened yet. Completed challenges
 * keep their final streak.
 */
export function effectiveStreak(challenge: Challenge, now: number): number {
  if (challenge.status === 'completed') return challenge.current_streak
  if (challenge.last_checkin_date === '') return 0
  const diff = dayIndexOfTs(now) - dayIndexOfDate(challenge.last_checkin_date)
  return diff >= 0 && diff <= 1 ? challenge.current_streak : 0
}

/** Whether today has already been checked in (the "I did it" button is spent). */
export function isDoneToday(challenge: Challenge, now: number): boolean {
  if (challenge.last_checkin_date === '') return false
  return dayIndexOfTs(now) === dayIndexOfDate(challenge.last_checkin_date)
}

export interface CheckinResult {
  challenge: Challenge
  decision: CheckinDecision
}

/**
 * Record an "I did it" tap: load the challenge, apply the streak math, and
 * persist. A no-op (already done today / already completed) returns the
 * unchanged challenge without a write. On completion, stamps the status +
 * completed_at and unlocks an affirmation from the bank.
 */
export async function recordCheckin(
  id: string,
  now: number = Date.now(),
  db: SqliteDatabase = getDb()
): Promise<Result<CheckinResult>> {
  const got = await getChallenge(id, db)
  if (!got.success) return got
  if (got.data == null) return err('CHALLENGE_NOT_FOUND', 'Challenge not found')

  const challenge = got.data
  const decision = evaluateCheckin(challenge, now)
  if (decision.outcome === 'already_done') {
    return ok({ challenge, decision })
  }

  const patch: ChallengePatch = {
    current_streak: decision.streak,
    last_checkin_date: toLocalDate(now),
  }
  if (decision.justCompleted) {
    patch.status = 'completed'
    patch.completed_at = now
    // Personalize the reward with the on-device model; fall back to the bank on
    // any failure so completion always unlocks something. Never blocks on a model
    // error (mirrors ADR 004 — LLM failures must not fail the user action).
    const gen = await generateAffirmation({
      title: challenge.title,
      details: challenge.details,
      targetDays: challenge.target_days,
    })
    patch.affirmation = gen.success ? gen.data : pickAffirmation()
  }

  const updated = await updateChallenge(id, patch, db)
  if (!updated.success) return updated
  return ok({ challenge: updated.data, decision })
}
