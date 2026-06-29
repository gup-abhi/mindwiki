// Feeling words offered at capture, grouped by where they sit on the
// energy×pleasantness grid (the circumplex model). Naming the feeling is itself
// the useful act — a better graph signal than letting the small model infer it.
// The grid quadrant the user taps decides which short list to offer; any landing
// on the middle band of either axis is ambiguous, so it gets the neutral set.

export type AffectQuadrant =
  | 'unpleasantHigh' // tense/activated + unpleasant
  | 'pleasantHigh' // activated + pleasant
  | 'unpleasantLow' // low energy + unpleasant
  | 'pleasantLow' // low energy + pleasant
  | 'neutral'

export const QUADRANT_FEELINGS: Record<AffectQuadrant, readonly string[]> = {
  unpleasantHigh: ['Anxious', 'Angry', 'Stressed', 'Tense', 'Overwhelmed', 'Frustrated'],
  pleasantHigh: ['Excited', 'Happy', 'Energized', 'Motivated', 'Joyful', 'Proud'],
  unpleasantLow: ['Sad', 'Tired', 'Lonely', 'Discouraged', 'Flat', 'Bored'],
  pleasantLow: ['Calm', 'Content', 'Relaxed', 'Grateful', 'Hopeful', 'Serene'],
  neutral: ['Okay', 'Fine', 'Uncertain', 'Restless', 'Distracted', 'Meh'],
}

const MID = 3 // the middle of the 1–5 axes — neither clearly high/low nor un/pleasant

/** The grid quadrant for a (pleasantness, energy) point; the middle band is neutral. */
export function quadrantFor(pleasantness: number, energy: number): AffectQuadrant {
  if (pleasantness === MID || energy === MID) return 'neutral'
  const pleasant = pleasantness > MID
  const high = energy > MID
  return pleasant ? (high ? 'pleasantHigh' : 'pleasantLow') : high ? 'unpleasantHigh' : 'unpleasantLow'
}

/** Feeling words to offer for a grid point; empty until both axes are set. */
export function feelingsForAffect(
  pleasantness: number | null,
  energy: number | null
): readonly string[] {
  if (pleasantness == null || energy == null) return []
  return QUADRANT_FEELINGS[quadrantFor(pleasantness, energy)]
}
