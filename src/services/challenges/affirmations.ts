// Affirmations unlocked when a challenge is completed — the reward the user can
// promote to the cover screen. A small curated bank; Phase 6 swaps this for an
// on-device LLM line generated from the challenge title, falling back here on
// failure. Generic and non-sensitive on purpose (the cover screen is its home).
export const AFFIRMATION_BANK: readonly string[] = [
  'I do what I say I will do.',
  'Consistency is who I am.',
  'I showed up — every single day.',
  'I keep my promises to myself.',
  'Discipline is my quiet superpower.',
  'I finish what I start.',
  'Small days, compounded, change everything.',
  'I am someone who follows through.',
]

/** A random affirmation from the bank (non-crypto — Math.random is fine here). */
export function pickAffirmation(): string {
  return AFFIRMATION_BANK[Math.floor(Math.random() * AFFIRMATION_BANK.length)]
}
