// Guided paths: short, themed reflection sequences the user works through in one
// sitting. Hand-authored and static on purpose — offline, instant, no model
// latency, and no risk of the small model fabricating the structure (the reason
// the auto-generated Pursuits feature was removed). The deep model only ever
// adds an optional "go deeper" follow-up *question* at runtime; the spine here
// is fixed. Prompts are soft invitations, never clinical demands.

export interface PathStep {
  /** The anchor reflection prompt shown for this step. */
  prompt: string
  /** An optional supporting line under the prompt. */
  hint?: string
}

export interface GuidedPath {
  id: string
  title: string
  /** One-line description shown in the browse list. */
  description: string
  /** A loose theme, used only to seed retrieval for the "go deeper" follow-up. */
  theme: string
  /** 3–5 steps, worked through in order. */
  steps: PathStep[]
}

export const GUIDED_PATHS: GuidedPath[] = [
  {
    id: 'overwhelmed',
    title: 'When you’re overwhelmed',
    description: 'Slow down and untangle what’s piling up.',
    theme: 'Overwhelm',
    steps: [
      { prompt: 'What’s taking up the most space in your head right now?' },
      {
        prompt: 'If you had to name just one thing underneath the rest, what would it be?',
        hint: 'Often the pile is really one worry wearing many hats.',
      },
      { prompt: 'What’s actually within your control here, and what isn’t?' },
      {
        prompt: 'What’s one small, kind thing you could do for yourself in the next hour?',
        hint: 'Small counts. It doesn’t have to fix anything.',
      },
    ],
  },
  {
    id: 'conflict',
    title: 'Untangling a conflict',
    description: 'Work through something that happened with someone.',
    theme: 'Conflict',
    steps: [
      { prompt: 'What happened, in your own words?' },
      { prompt: 'What did you feel in that moment — and what were you needing?' },
      {
        prompt: 'If you imagine their side for a moment, what might they have been feeling or needing?',
        hint: 'Not to excuse it — just to see it more fully.',
      },
      { prompt: 'What would a fair, honest next step look like for you?' },
    ],
  },
  {
    id: 'what-went-well',
    title: 'What went well',
    description: 'Notice the good that’s easy to skip past.',
    theme: 'Gratitude',
    steps: [
      { prompt: 'What’s one thing that went well recently, however small?' },
      {
        prompt: 'What part did you play in it?',
        hint: 'It’s easy to credit luck and forget your own effort.',
      },
      { prompt: 'How did it feel — and where did you feel it?' },
      { prompt: 'What would it look like to make a little more room for this?' },
    ],
  },
  {
    id: 'hard-feeling',
    title: 'Sitting with a hard feeling',
    description: 'Make space for something difficult, gently.',
    theme: 'Difficult emotion',
    steps: [
      { prompt: 'What’s the feeling that’s been hardest to sit with lately?' },
      {
        prompt: 'Where do you notice it in your body?',
        hint: 'Feelings often show up physically before we have words for them.',
      },
      { prompt: 'If this feeling could speak, what might it be trying to tell you?' },
      {
        prompt: 'What do you most need right now — and who or what could offer it?',
        hint: 'You’re allowed to need things.',
      },
    ],
  },
]

/** A path by id, or undefined if the id isn't in the catalog. */
export function getGuidedPath(id: string): GuidedPath | undefined {
  return GUIDED_PATHS.find((p) => p.id === id)
}
