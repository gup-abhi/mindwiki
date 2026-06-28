// Optional feeling words offered at capture, one short row per mood. Naming the
// feeling is itself the useful act (it's a better graph signal than letting the
// small model infer emotion from the text). Curated, everyday, non-clinical —
// single words, valence-matched to the 1–5 mood so the suggestion is one tap.
// Skippable: when no word is picked, the model still derives `emotion`.

export const MOOD_FEELINGS: Record<number, readonly string[]> = {
  1: ['Overwhelmed', 'Anxious', 'Hopeless', 'Angry', 'Ashamed', 'Exhausted'],
  2: ['Sad', 'Worried', 'Frustrated', 'Lonely', 'Tired', 'Discouraged'],
  3: ['Restless', 'Uncertain', 'Distracted', 'Flat', 'Calm', 'Fine'],
  4: ['Content', 'Hopeful', 'Motivated', 'Relieved', 'Grateful', 'Calm'],
  5: ['Happy', 'Excited', 'Proud', 'Grateful', 'Energized', 'Loved'],
}

/** The feeling words to offer for a given mood (1–5); empty when no mood chosen. */
export function feelingsForMood(mood: number | null): readonly string[] {
  return mood == null ? [] : (MOOD_FEELINGS[mood] ?? [])
}
