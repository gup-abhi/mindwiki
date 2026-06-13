/**
 * Daily reminder copy. Warm, brief, non-clinical (never implies diagnosis or
 * treatment). Rotated by day so the same prompt isn't shown two days running.
 */
export const REMINDER_COPY: readonly string[] = [
  'A minute with your thoughts? Today’s entry is waiting.',
  'What’s on your mind right now?',
  'Take a breath. Jot down how today felt.',
  'Your wiki grows a little with every entry.',
  'One small note to yourself — what happened today?',
  'Check in with yourself for a moment.',
  'A thought worth keeping? Write it down.',
  'How are you, really? Tell your journal.',
  'Two minutes of reflection can shift a whole day.',
  'Notice something today? Capture it before it fades.',
  'Your future self will thank you for today’s note.',
  'Ready to add to your story?',
] as const

/** Pick the reminder for a given day index (rotates, wraps, handles negatives). */
export function reminderCopy(dayIndex: number): string {
  const n = REMINDER_COPY.length
  return REMINDER_COPY[((dayIndex % n) + n) % n]
}

/**
 * Daily challenge-nudge copy. Deliberately generic: it never names the challenge
 * or a streak count, because notifications surface on the lock screen *before*
 * the password — so the content must reveal nothing. (A baked-in "Day 12" would
 * also go stale if the streak resets.) Rotated by day.
 */
export const CHALLENGE_COPY: readonly string[] = [
  'Keep your streak alive today. 🔥',
  'Show up for yourself today.',
  'One more day. You’ve got this.',
  'Don’t break the chain.',
  'Today counts. Make it happen.',
  'Small effort today, big you tomorrow.',
  'Your challenge is waiting. 💪',
  'Stay consistent — tap when it’s done.',
] as const

/** Pick the challenge nudge for a given day index (rotates, wraps, handles negatives). */
export function challengeCopy(dayIndex: number): string {
  const n = CHALLENGE_COPY.length
  return CHALLENGE_COPY[((dayIndex % n) + n) % n]
}
