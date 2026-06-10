// Gentle, open journaling prompts shown above the entry field so the user never
// faces a blank page. Curated + static on purpose: offline, instant, no model
// latency. Phrased as soft invitations, never demands or clinical questions.
export const JOURNAL_PROMPTS = [
  'What’s been on your mind today?',
  'What’s weighing on you right now?',
  'What happened today that stuck with you?',
  'How are you, really?',
  'What’s taking up the most space in your head?',
  'Is there something you need to get off your chest?',
  'What felt hard today — and what helped?',
  'What are you grateful for, even a little?',
  'What would you tell a friend who felt the way you do?',
  'What do you want to remember about today?',
  'What’s a feeling you’ve been sitting with?',
  'What’s one thing you wish someone understood?',
] as const

/** A random prompt, optionally avoiding the current one so "shuffle" always changes. */
export function randomPrompt(exclude?: string): string {
  const pool = exclude ? JOURNAL_PROMPTS.filter((p) => p !== exclude) : JOURNAL_PROMPTS
  return pool[Math.floor(Math.random() * pool.length)]
}
