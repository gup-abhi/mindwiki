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
