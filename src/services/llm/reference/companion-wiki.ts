// The companion's own helper wiki: private, bundled know-how the Reflect
// companion retrieves per message — the counterpart to the USER's wiki. The
// user wiki is their memory (what happened to them); this is the companion's
// craft (how to recognize a thinking pattern in the live message and respond
// helpfully). Retrieval keeps the prompt honest: instead of a fixed taxonomy
// block in every turn (which primed clinical, interviewer-ish framing and was
// capped at 8 of 14 patterns), only the one or two notes the message actually
// touches are injected — with their FULL reframe guidance.
//
// v1 content is repackaged from DISTORTION_REFERENCE (write-own, standard CBT,
// non-clinical). NOT user data — bundled, read-only, never stored/synced.

import { DISTORTION_REFERENCE } from './distortions'

export interface HelperNote {
  /** Canonical distortion key (matches taxonomy). */
  id: string
  title: string
  /** Lowercase cues that suggest the pattern in a user message. Single words
   *  match on word boundaries; phrases match as substrings. */
  triggers: string[]
  /** Private guidance for the companion — never shown or quoted to the user. */
  content: string
}

// Hand-authored message cues per distortion. Deliberately first-person-flavored
// (these run against what the USER typed, not clinical vocabulary).
const TRIGGERS: Record<string, string[]> = {
  'All-or-nothing thinking': ['ruined', 'complete failure', 'total failure', 'no point', 'pointless', 'completely', 'perfect or'],
  Overgeneralization: ['always', 'never', 'every time', 'nobody', 'everybody', 'no one ever', 'nothing ever'],
  'Mental filter': ['keep replaying', "can't stop thinking", 'keep thinking about', 'that one thing', 'stuck on'],
  'Discounting the positive': ["doesn't count", 'just being nice', 'anyone could have', 'only said that', "doesn't really count"],
  'Jumping to conclusions': ['definitely', 'i just know', 'bound to', 'going to go wrong', 'no way this works'],
  'Mind reading': ['they think', 'thinks i', 'must be annoyed', 'probably hates', 'judging me', 'done with me'],
  Catastrophizing: ['worst', 'disaster', 'catastrophe', 'get fired', 'something serious', 'never recover', 'fall apart'],
  'Emotional reasoning': ['i feel like a', 'so i must be', 'must be true', 'feels true'],
  'Should statements': ['should', 'must', 'ought', 'supposed to', 'have to be'],
  Labeling: ["i'm an idiot", "i'm such a", "i'm a failure", "i'm useless", 'stupid', 'worthless', 'a jerk'],
  Personalization: ['my fault', 'because of me', 'blame myself', 'i caused'],
  Blaming: ['their fault', 'because of them', 'because of him', 'because of her', 'if they just'],
  Magnification: ['total disaster', 'huge deal', 'everyone will remember', 'end of the world'],
  Minimization: ['not a big deal', 'barely counts', "doesn't matter that i", 'nothing special'],
}

// Non-distortion notes: emotional states that need a presence-first response
// rather than a reframe. Loneliness is the first — the 3B model's reflex on
// isolation is "suggest people to contact", which contradicts a user who has
// just said they have no one. This note (and the constraint pins) steer it to
// stay and witness instead. Appended after the distortion notes so ordering is
// deterministic; counts toward the same `max` cap.
const NON_DISTORTION_NOTES: HelperNote[] = [
  {
    id: 'Loneliness',
    title: 'Loneliness',
    triggers: ['lonely', 'alone', 'no one', 'nobody', 'isolated'],
    content:
      'They may be feeling isolated. Do not try to fix the isolation or suggest people to contact — be the one who is listening right now. Name the loneliness gently and stay with it.',
  },
]

/** The full helper wiki: one note per canonical distortion (each carrying the
 *  whole reframe lens), plus non-distortion notes appended in table order. */
export const HELPER_NOTES: HelperNote[] = [
  ...Object.values(DISTORTION_REFERENCE).map((d) => ({
    id: d.name,
    title: d.name,
    triggers: TRIGGERS[d.name] ?? [],
    content:
      `Their message may show ${d.definition.toLowerCase()} ` +
      `(like "${d.examples[0]}"). After validating the feeling, you could gently wonder with them: ${d.reframe}`,
  })),
  ...NON_DISTORTION_NOTES,
]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Retrieve the helper notes a user message touches — most cue hits first, at
 * most `max` (the prompt budget is shared with wiki pages and history, so this
 * stays small). Single-word cues match whole words only ("mustard" is not
 * "must"); phrase cues match anywhere. Deterministic and cheap — no model run.
 */
export function selectHelperNotes(message: string, max = 2): HelperNote[] {
  const text = message.toLowerCase()
  const scored: { note: HelperNote; hits: number }[] = []
  for (const note of HELPER_NOTES) {
    let hits = 0
    for (const t of note.triggers) {
      const matched = t.includes(' ')
        ? text.includes(t)
        : new RegExp(`\\b${escapeRegExp(t)}\\b`).test(text)
      if (matched) hits++
    }
    if (hits > 0) scored.push({ note, hits })
  }
  return scored
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .map((s) => s.note)
}
