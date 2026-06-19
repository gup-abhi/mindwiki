// Static psychoeducation reference for the 14 CBT cognitive distortions. NOT
// user data — bundled app content, read-only, never stored/synced/graphed. Keys
// MUST match the canonical DISTORTIONS in ../taxonomy.ts exactly (that's what
// entries are tagged/snapped to). Content is write-own (the concepts are
// standard CBT, not copyrightable); examples are short first-person thoughts so
// the model can RECOGNIZE the pattern, plus one reframe lens.

import { DISTORTIONS } from '../taxonomy'

export interface DistortionEntry {
  /** Canonical name (matches the taxonomy key). */
  name: string
  /** One-line plain-language definition. */
  definition: string
  /** Short first-person thoughts that exemplify the pattern (for identification). */
  examples: string[]
  /** A gentle reframe lens — how to loosen the thought, phrased as an invitation. */
  reframe: string
}

export const DISTORTION_REFERENCE: Record<string, DistortionEntry> = {
  'All-or-nothing thinking': {
    name: 'All-or-nothing thinking',
    definition: 'seeing things in absolute extremes — total success or total failure, with no middle ground',
    examples: ['If it’s not perfect, it’s a complete failure.', 'I ate one cookie, so I’ve ruined the whole diet.'],
    reframe: 'where’s the middle ground here — what partly went well, even if it wasn’t perfect?',
  },
  Overgeneralization: {
    name: 'Overgeneralization',
    definition: 'treating one event as a never-ending pattern, often with words like "always" or "never"',
    examples: ['I always mess things up.', 'Nobody ever wants to spend time with me.'],
    reframe: 'is this one moment, or truly every time — what does the fuller picture across time actually show?',
  },
  'Mental filter': {
    name: 'Mental filter',
    definition: 'dwelling on a single negative detail so it colours the whole picture',
    examples: ['One person frowned during my talk, so it went badly.', 'I keep replaying the one thing I got wrong today.'],
    reframe: 'what else was true about the situation besides that one detail?',
  },
  'Discounting the positive': {
    name: 'Discounting the positive',
    definition: 'insisting good things "don’t count," so positives never land',
    examples: ['They only praised me to be nice.', 'I did well, but anyone could have done that.'],
    reframe: 'what if the positives count as real evidence too — what would it mean to let this one in?',
  },
  'Jumping to conclusions': {
    name: 'Jumping to conclusions',
    definition: 'drawing a firm negative conclusion without the evidence to support it',
    examples: ['This is going to go wrong, I just know it.', 'They didn’t reply, so it’s definitely over.'],
    reframe: 'what facts actually support this, and what other explanation could fit?',
  },
  'Mind reading': {
    name: 'Mind reading',
    definition: 'assuming you know what others are thinking, usually that they judge you',
    examples: ['Everyone there thinks I’m boring.', 'She didn’t say much, so she must be annoyed with me.'],
    reframe: 'you can’t see inside their head — what’s another read, and could you check rather than assume?',
  },
  Catastrophizing: {
    name: 'Catastrophizing',
    definition: 'expecting the worst-case outcome and treating it as certain',
    examples: ['If I send this email wrong I’ll get fired.', 'This headache is probably something serious.'],
    reframe: 'what’s the most likely outcome, and could you cope with it if it happened?',
  },
  'Emotional reasoning': {
    name: 'Emotional reasoning',
    definition: 'taking a feeling as proof of fact — "I feel it, so it must be true"',
    examples: ['I feel like a failure, so I must be one.', 'I feel guilty, so I must have done something wrong.'],
    reframe: 'a feeling is a signal, not a verdict — if you set the feeling aside, what does the evidence say?',
  },
  'Should statements': {
    name: 'Should statements',
    definition: 'rigid rules — "should," "must," "ought" — that breed guilt and pressure',
    examples: ['I should be further along by now.', 'I must never let anyone down.'],
    reframe: 'what happens if "should" becomes "would like to" — does the rule still serve you?',
  },
  Labeling: {
    name: 'Labeling',
    definition: 'attaching a fixed, global label to yourself or others instead of describing the behaviour',
    examples: ['I’m an idiot.', 'He’s just a jerk.'],
    reframe: 'describe what actually happened rather than a permanent label — a mistake isn’t an identity.',
  },
  Personalization: {
    name: 'Personalization',
    definition: 'taking responsibility for things that weren’t fully in your control',
    examples: ['My friend is upset — it must be my fault.', 'The team missed the deadline because of me.'],
    reframe: 'what other factors were at play here, and what share was genuinely yours?',
  },
  Blaming: {
    name: 'Blaming',
    definition: 'holding others wholly responsible while overlooking your own part',
    examples: ['It’s entirely their fault I feel this way.', 'I’d be fine if they just acted differently.'],
    reframe: 'what part of this is within your influence to change, regardless of them?',
  },
  Magnification: {
    name: 'Magnification',
    definition: 'blowing the importance of a problem or flaw out of proportion',
    examples: ['This mistake is a total disaster.', 'Everyone is going to remember this forever.'],
    reframe: 'right-size it — how much will this actually matter a week or a year from now?',
  },
  Minimization: {
    name: 'Minimization',
    definition: 'shrinking the importance of your strengths, wins, or good qualities',
    examples: ['It’s not a big deal that I finished it.', 'Sure I helped, but that barely counts.'],
    reframe: 'give this its real weight — if a friend had done it, how would you describe it?',
  },
}

// Fail loudly in dev if the reference ever drifts from the taxonomy.
if (__DEV__) {
  for (const d of DISTORTIONS) {
    if (!DISTORTION_REFERENCE[d]) {
      // eslint-disable-next-line no-console
      console.warn(`[reference] missing distortion entry for "${d}"`)
    }
  }
}
