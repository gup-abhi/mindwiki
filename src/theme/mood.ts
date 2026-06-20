import { type ColorTokens } from './colors'

// Mood is the user's own 1–5 rating (always set on an entry), distinct from the
// model's 0–1 mood_score. These map a mood level to its label + color token so
// the list cards and detail screen read mood consistently.

const MOOD_LABELS = ['', 'Very low', 'Low', 'Okay', 'Good', 'Great'] as const

const MOOD_COLOR_KEYS: (keyof ColorTokens)[] = [
  'moodOkay', // index 0 unused; safe fallback
  'moodVeryLow',
  'moodLow',
  'moodOkay',
  'moodGood',
  'moodGreat',
]

/** Clamp any mood number to the valid 1–5 range. */
function clampMood(mood: number): number {
  return Math.min(5, Math.max(1, Math.round(mood)))
}

/** Human label for a 1–5 mood ("Very low" … "Great"). */
export function moodLabel(mood: number): string {
  return MOOD_LABELS[clampMood(mood)]
}

/** Theme color-token key for a 1–5 mood, for the entry color bar + mood chips. */
export function moodColorKey(mood: number): keyof ColorTokens {
  return MOOD_COLOR_KEYS[clampMood(mood)]
}
