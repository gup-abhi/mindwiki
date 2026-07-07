import { runDigestSynthesis } from '@/services/digest/agents/orchestrator'
import { type Digest } from '@/services/digest/generator'
import { synthesizeDigest } from '@/services/llm/deep-model'
import { type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ synthesizeDigest: jest.fn() }))

const mockSynth = synthesizeDigest as jest.Mock

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
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

const digest: Digest = {
  weekStart: 0,
  weekEnd: 1,
  entryCount: 7,
  dayCount: 5,
  avgMood: 3,
  moodDelta: null,
  moodArc: [],
  emotionMix: [{ label: 'anxiety', count: 2 }],
  brightest: null,
  toughest: null,
  pattern: 'mostly anxiety',
  correlation: 'low days carried dread',
  moodBlindSpot: null,
  selfCriticism: null,
  emotionDisguise: null,
  emotionUndersell: null,
  weeklyRhythm: null,
  momentum: null,
  question: 'TEMPLATE question?',
  quote: 'q',
}

const entries = [
  entry('1', { situation: 'work deadline', thought: 'I keep avoiding it', emotion: 'anxiety' }),
  entry('2', { situation: 'meeting', thought: 'felt drained', emotion: 'anxiety' }),
]

const base = { digest, entries, nodes: [], edges: [], pages: [] }

describe('runDigestSynthesis', () => {
  beforeEach(() => mockSynth.mockReset())

  it('adds critic-validated synthesis when the analyst succeeds', async () => {
    mockSynth.mockResolvedValue(
      ok({
        themes: ['Work pressure recurred', 'A trip to the moon'],
        patterns: ['Avoiding work when anxious'],
        openQuestions: ['What helps you reset?'],
      })
    )

    const out = await runDigestSynthesis(base)

    expect(out.synthesis?.themes).toEqual(['Work pressure recurred'])
    expect(out.synthesis?.flaggedClaims).toEqual(['A trip to the moon'])
    expect(out.question).toBe('TEMPLATE question?') // deterministic fields untouched
  })

  it('returns the digest unchanged when the analyst keeps failing', async () => {
    mockSynth.mockResolvedValue(err('DIGEST_SYNTH_INFERENCE_FAILED', 'down'))

    const out = await runDigestSynthesis(base)

    expect(out.synthesis).toBeUndefined()
    expect(mockSynth).toHaveBeenCalledTimes(2) // bounded retry
  })

  it('skips the model entirely when there is no material', async () => {
    const out = await runDigestSynthesis({ ...base, entries: [] })
    expect(out.synthesis).toBeUndefined()
    expect(mockSynth).not.toHaveBeenCalled()
  })
})
