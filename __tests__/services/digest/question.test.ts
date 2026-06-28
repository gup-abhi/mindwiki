import { enrichWithQuestion } from '@/services/digest/question'
import { generateReflectionQuestion } from '@/services/llm/deep-model'
import { type Digest } from '@/services/digest/generator'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ generateReflectionQuestion: jest.fn() }))

const mockGen = generateReflectionQuestion as jest.Mock

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
  question: 'TEMPLATE question?',
  quote: 'q',
}

describe('enrichWithQuestion', () => {
  beforeEach(() => mockGen.mockReset())

  it('replaces the templated question when the LLM succeeds', async () => {
    mockGen.mockResolvedValue(ok('What grounds you?'))
    const out = await enrichWithQuestion(digest)
    expect(out.question).toBe('What grounds you?')
    expect(mockGen).toHaveBeenCalledWith({
      pattern: 'mostly anxiety',
      correlation: 'low days carried dread',
    })
  })

  it('keeps the template when the LLM fails', async () => {
    mockGen.mockResolvedValue(err('DIGEST_QUESTION_INFERENCE_FAILED', 'down'))
    const out = await enrichWithQuestion(digest)
    expect(out.question).toBe('TEMPLATE question?')
  })
})
