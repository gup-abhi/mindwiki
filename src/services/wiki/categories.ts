// The categories the wiki engine assigns to pages (see candidateTopics in
// engine.ts). "other" is a display-only fallback for pages with a null/unknown
// category (e.g. created before categories existed).
export const CATEGORY_ORDER = [
  'emotion',
  'distortion',
  'belief',
  'behavior',
  'theme',
  'person',
  'place',
  'activity',
  'other',
] as const

export const CATEGORY_LABEL: Record<string, string> = {
  emotion: 'Emotions',
  distortion: 'Distortions',
  belief: 'Beliefs',
  behavior: 'Behaviours',
  theme: 'Themes',
  person: 'People',
  place: 'Places',
  activity: 'Activities',
  other: 'Other',
}

/** Normalize a page's raw category into a known bucket key. */
export function categoryKey(category: string | null): string {
  return category && CATEGORY_LABEL[category] ? category : 'other'
}

/** Human label for a bucket key (falls back to the key itself). */
export function categoryLabel(key: string): string {
  return CATEGORY_LABEL[key] ?? key
}
