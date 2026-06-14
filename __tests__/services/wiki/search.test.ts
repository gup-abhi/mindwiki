import { rankPages, rankEntries, queryTerms } from '@/services/wiki/search'
import { type WikiPage } from '@/services/storage/wiki'
import { type Entry } from '@/services/storage/entries'

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
  dismissed_at: null,
  corrected_at: null,
  ...over,
})

describe('queryTerms', () => {
  it('drops stopwords and 1-char tokens, lowercases, dedupes', () => {
    expect(queryTerms('Why am I so Anxious about anxious work?')).toEqual(['so', 'anxious', 'work'])
  })

  it('is empty for an all-stopword query', () => {
    expect(queryTerms('what is it about')).toEqual([])
  })
})

describe('rankPages', () => {
  it('returns nothing for an empty/stopword-only query', () => {
    expect(rankPages('the and is', [page({ title: 'Anxiety' })])).toEqual([])
  })

  it('ranks a title match above a content-only match', () => {
    const titleHit = page({ title: 'Anxiety', content: 'nothing relevant' })
    const contentHit = page({ title: 'Work', content: 'anxiety shows up sometimes' })
    const out = rankPages('anxiety', [contentHit, titleHit])
    expect(out[0].page).toBe(titleHit)
  })

  it('scores content matches by frequency', () => {
    const few = page({ title: 'A', content: 'sleep' })
    const many = page({ title: 'B', content: 'sleep sleep sleep' })
    const out = rankPages('sleep', [few, many])
    expect(out[0].page).toBe(many)
  })

  it('drops non-matching pages and respects the limit', () => {
    const pages = [
      page({ title: 'Anxiety', content: 'anxiety' }),
      page({ title: 'Work', content: 'work' }),
      page({ title: 'Sleep', content: 'sleep' }),
    ]
    const out = rankPages('anxiety', pages, 5)
    expect(out).toHaveLength(1)
    expect(out[0].page.title).toBe('Anxiety')
  })

  it('uses entry_count only as a gentle tiebreak', () => {
    const a = page({ title: 'Anxiety', content: 'anxiety', entry_count: 1 })
    const b = page({ title: 'Anxiety', content: 'anxiety', entry_count: 9 })
    const out = rankPages('anxiety', [a, b])
    expect(out[0].page).toBe(b) // same term score, richer page wins
  })
})

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: Math.random().toString(36),
  created_at: 0,
  mood: 3,
  situation: '',
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  distortion: null,
  mood_score: null,
  topic: null,
  tagged_at: null,
  source: 'journal',
  ...over,
})

describe('rankEntries', () => {
  it('returns nothing for a stopword-only query', () => {
    expect(rankEntries('the and', [entry({ situation: 'work stress' })])).toEqual([])
  })

  it('ranks by term overlap across entry text and drops non-matches', () => {
    const a = entry({ id: 'a', situation: 'work deadline', thought: 'I will fail at work' })
    const b = entry({ id: 'b', situation: 'a calm walk' })
    const out = rankEntries('work', [a, b])
    expect(out.map((e) => e.id)).toEqual(['a'])
  })

  it('breaks ties by most recent', () => {
    const older = entry({ id: 'old', situation: 'work', created_at: 100 })
    const newer = entry({ id: 'new', situation: 'work', created_at: 200 })
    const out = rankEntries('work', [older, newer])
    expect(out[0].id).toBe('new')
  })

  it('matches the tagged emotion too', () => {
    const e = entry({ id: 'e', situation: 's', thought: 't', emotion: 'loneliness' })
    expect(rankEntries('loneliness', [e]).map((x) => x.id)).toEqual(['e'])
  })
})
