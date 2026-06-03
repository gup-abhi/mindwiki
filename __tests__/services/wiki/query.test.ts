import { answerQuestion, suggestedQuestions } from '@/services/wiki/query'
import { answerFromWiki } from '@/services/llm/deep-model'
import { type WikiPage } from '@/services/storage/wiki'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ answerFromWiki: jest.fn() }))

const mockAnswer = answerFromWiki as jest.Mock

const page = (over: Partial<WikiPage> = {}): WikiPage => ({
  id: Math.random().toString(36),
  title: 'Untitled',
  category: null,
  content: '',
  entry_count: 1,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
  ...over,
})

describe('answerQuestion', () => {
  beforeEach(() => mockAnswer.mockReset())

  it('returns a friendly message and skips the model when nothing matches', async () => {
    const res = await answerQuestion('quantum physics', [page({ title: 'Anxiety', content: 'anxiety' })])
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.sources).toEqual([])
      expect(res.data.evidenceCount).toBe(0)
      expect(res.data.answer).toMatch(/find anything in your wiki/)
    }
    expect(mockAnswer).not.toHaveBeenCalled()
  })

  it('grounds the model in the matched pages and reports sources + evidence', async () => {
    mockAnswer.mockResolvedValue(ok('Deadlines spike it.'))
    const work = page({ title: 'Work', content: 'anxiety from deadlines', entry_count: 4 })
    const sleep = page({ title: 'Sleep', content: 'anxiety before bed', entry_count: 2 })

    const res = await answerQuestion('anxiety', [work, sleep, page({ title: 'Food', content: 'lunch' })])

    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.answer).toBe('Deadlines spike it.')
      expect(res.data.sources.map((p) => p.title).sort()).toEqual(['Sleep', 'Work'])
      expect(res.data.evidenceCount).toBe(6) // 4 + 2
    }
    // model was given only the matched pages
    expect(mockAnswer).toHaveBeenCalledWith({
      question: 'anxiety',
      sources: expect.arrayContaining([{ title: 'Work', content: 'anxiety from deadlines' }]),
    })
  })

  it('propagates a model failure', async () => {
    mockAnswer.mockResolvedValue(err('WIKI_ANSWER_INFERENCE_FAILED', 'down'))
    const res = await answerQuestion('anxiety', [page({ title: 'Anxiety', content: 'anxiety' })])
    expect(res.success).toBe(false)
  })
})

describe('suggestedQuestions', () => {
  it('seeds from the richest pages, most entries first, within the limit', () => {
    const pages = [
      page({ title: 'Work', entry_count: 2 }),
      page({ title: 'Sleep', entry_count: 9 }),
      page({ title: 'Food', entry_count: 5 }),
      page({ title: 'Empty', entry_count: 0 }),
    ]
    const qs = suggestedQuestions(pages, 2)
    expect(qs).toHaveLength(2)
    expect(qs[0]).toContain('Sleep') // richest first
    expect(qs[1]).toContain('Food')
    expect(qs.every((q) => q.endsWith('?'))).toBe(true)
  })

  it('skips pages with no entries and returns nothing when none qualify', () => {
    expect(suggestedQuestions([page({ entry_count: 0 })])).toEqual([])
  })
})
