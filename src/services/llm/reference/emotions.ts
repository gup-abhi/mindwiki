// Short cue lines for the 26 canonical EMOTIONS. Taxonomy is informed by
// GoEmotions (Apache-2.0) but the list + these cues are write-own. Keys MUST
// match ../taxonomy.ts. Used only in the synthesis decode block (the deep model
// already knows emotions; cues just sharpen what the tag points at). NOT user
// data — bundled, read-only.

import { EMOTIONS } from '../taxonomy'

export const EMOTION_REFERENCE: Record<string, string> = {
  Anxiety: 'unease or dread about something that might go wrong',
  Fear: 'response to a specific, present threat',
  Stress: 'feeling stretched by demands that outweigh your resources',
  Overwhelm: 'too much at once, more than you can process or hold',
  Anger: 'response to feeling wronged, blocked, or violated',
  Frustration: 'irritation at being thwarted or stuck',
  Sadness: 'low, heavy mood, often from loss or letdown',
  Loneliness: 'feeling disconnected or unseen, even around others',
  Grief: 'deep sorrow over a real loss',
  Disappointment: 'the gap between what you hoped for and what happened',
  Guilt: 'feeling bad about something you did or failed to do',
  Shame: 'feeling fundamentally bad about who you are, not just what you did',
  Embarrassment: 'self-consciousness after feeling exposed or judged',
  Insecurity: 'doubt about your own worth or adequacy',
  Jealousy: 'fear of losing something or someone to a rival',
  Confusion: 'uncertainty, pulled in conflicting directions',
  Boredom: 'restlessness from a lack of meaning or stimulation',
  Calm: 'settled, at ease, low arousal',
  Contentment: 'quiet satisfaction with how things are',
  Joy: 'bright, uplifted, happy mood',
  Gratitude: 'warmth and appreciation for something received',
  Hope: 'expecting that things can improve',
  Pride: 'satisfaction in your own effort or achievement',
  Excitement: 'energised anticipation of something good',
  Love: 'warm attachment and care for someone',
  Relief: 'the easing of tension once a threat has passed',
}

if (__DEV__) {
  for (const e of EMOTIONS) {
    if (!EMOTION_REFERENCE[e]) {
      // eslint-disable-next-line no-console
      console.warn(`[reference] missing emotion cue for "${e}"`)
    }
  }
}
