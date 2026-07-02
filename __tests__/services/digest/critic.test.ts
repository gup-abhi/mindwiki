import { critique } from '@/services/digest/agents/critic'
import { type DigestSynthesis } from '@/services/llm/schemas/digest-synthesis.schema'
import { type Entry } from '@/services/storage/entries'

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  created_at: 0,
  mood: 3,
  situation: '',
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  tagged_at: null,
  wiki_indexed_at: null,
  source: 'journal',
  ...over,
})

const entries = [
  entry('1', { situation: 'work deadline approaching', thought: 'I keep avoiding the task', emotion: 'anxiety' }),
  entry('2', { situation: 'long meeting', thought: 'felt drained afterwards', emotion: 'tired' }),
]

describe('critique', () => {
  it('keeps supported claims and drops unsupported ones', () => {
    const synthesis: DigestSynthesis = {
      themes: ['Work pressure showed up often', 'A sudden interest in skydiving'],
      patterns: ['Avoiding tasks when anxious'],
      openQuestions: ['What helps you reset after a draining day?'],
    }

    const out = critique(synthesis, entries)

    expect(out.synthesis.themes).toEqual(['Work pressure showed up often'])
    expect(out.synthesis.patterns).toEqual(['Avoiding tasks when anxious'])
    expect(out.flaggedClaims).toEqual(['A sudden interest in skydiving'])
  })

  it('always keeps open questions (they are prompts, not assertions)', () => {
    const synthesis: DigestSynthesis = {
      themes: ['unsupported claim about volcanoes'],
      patterns: ['another unsupported claim about glaciers'],
      openQuestions: ['What would a kinder week look like?'],
    }

    const out = critique(synthesis, entries)

    expect(out.synthesis.themes).toEqual([])
    expect(out.synthesis.patterns).toEqual([])
    expect(out.synthesis.openQuestions).toEqual(['What would a kinder week look like?'])
    expect(out.flaggedClaims).toHaveLength(2)
  })
})
