import { suggestedQuestions } from '@/services/wiki/query'
import { type WikiPage } from '@/services/storage/wiki'

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
