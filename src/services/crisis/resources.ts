export interface CrisisResource {
  name: string
  contact: string
  description: string
}

// Surfaced to the user on a crisis detection. NOTE: US/NA-centric for now —
// localization is a later concern. The app provides support resources only; it
// does not diagnose or treat.
export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    name: '988 Suicide & Crisis Lifeline',
    contact: 'Call or text 988',
    description: 'Free, confidential support, 24/7 (US).',
  },
  {
    name: 'Crisis Text Line',
    contact: 'Text HOME to 741741',
    description: '24/7 crisis support via text (US, Canada, UK, Ireland).',
  },
]
