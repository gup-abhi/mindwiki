// Constraint pins: durable facts a user states about their circumstances that
// the companion must not contradict — chiefly "I have no one to talk to". Unlike
// the 8-message recent window, a constraint stated early scrolls out of view and
// the 3B model's instruction-tuned reflex ("distress → reach out") then
// contradicts it. This module scans the WHOLE conversation for such statements
// and turns each into a pinned steer that rides in every turn's system prompt.
//
// Same idiom as selectHelperNotes: pure, deterministic, cheap (no model run),
// substring cue matching (phrases) like companion-wiki's TRIGGERS.

export interface Constraint {
  /** Stable id, deduped across turns. */
  id: string
  /** Prompt steer pinned into the system message while the constraint holds. */
  steer: string
}

// Lowercase cue → constraint. Cues are matched as substrings against each user
// turn (lowercased). Keep the list tight to avoid false positives: every cue
// here asserts absence of support, not the mere mention of a person.
const CONSTRAINT_TABLE: { id: string; cues: string[]; steer: string }[] = [
  {
    id: 'no-support-network',
    cues: [
      'no one to talk to',
      'nobody to talk to',
      "don't have anyone",
      'dont have anyone',
      'no friends',
      'nobody to turn to',
      'no one i can talk',
      'all alone in this',
    ],
    steer:
      "They have told you they don't have anyone to talk to. Never suggest reaching out to, talking to, or confiding in other people — you are the one who is here. Reflect what it is like to carry this alone.",
  },
  {
    id: 'no-therapy-access',
    cues: ["can't afford therapy", 'cant afford therapy', 'no therapist', "can't see a therapist"],
    steer:
      "They have told you they can't access therapy right now. Do not suggest seeing a therapist or getting professional help — stay with them in what they can reach today.",
  },
  {
    id: 'unsafe-family',
    cues: ["can't talk to my family", "family isn't safe", "family wouldn't understand"],
    steer:
      'They have told you their family is not someone they can turn to. Do not suggest talking to or leaning on family — hold that door closed with them.',
  },
]

/**
 * Detect the durable constraints a conversation's user turns assert. Scans ALL
 * user turns (full history, not the trimmed window), matches cues as substrings,
 * dedupes by id, order-stable (first-appearance order). Pure. Non-matches stay
 * non-matches: "I talked to my mom today" triggers nothing.
 */
export function detectConstraints(userTurns: string[]): Constraint[] {
  const seen = new Set<string>()
  const out: Constraint[] = []
  for (const turn of userTurns) {
    const text = turn.toLowerCase()
    for (const c of CONSTRAINT_TABLE) {
      if (seen.has(c.id)) continue
      if (c.cues.some((cue) => text.includes(cue))) {
        seen.add(c.id)
        out.push({ id: c.id, steer: c.steer })
      }
    }
  }
  return out
}
