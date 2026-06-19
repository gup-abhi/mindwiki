import {
  canonicalizeEmotion,
  canonicalizeDistortion,
  canonicalizeLabel,
  normalizeEntities,
} from '@/services/llm/taxonomy'

describe('controlled vocabulary', () => {
  it('snaps emotion synonyms/variants to a single canonical term', () => {
    expect(canonicalizeEmotion('anxious')).toBe('Anxiety') // alias
    expect(canonicalizeEmotion('nervous')).toBe('Anxiety') // alias
    expect(canonicalizeEmotion('ANXIETY')).toBe('Anxiety') // exact, case-insensitive
    expect(canonicalizeEmotion('saddness')).toBe('Sadness') // fuzzy (typo) -> nearest
  })

  it('snaps distortions and resolves unknowns to none', () => {
    expect(canonicalizeDistortion('catastrophising')).toBe('Catastrophizing') // alias spelling
    expect(canonicalizeDistortion('mind-reading')).toBe('Mind reading') // alias
    expect(canonicalizeDistortion('none')).toBe('none')
    expect(canonicalizeDistortion('totally unrelated phrase')).toBe('none') // unknown -> none
  })
})

describe('canonicalizeLabel', () => {
  it('strips a leading article, collapses whitespace, title-cases — so variants merge', () => {
    expect(canonicalizeLabel('the app')).toBe('App')
    expect(canonicalizeLabel('  my   app ')).toBe('App')
    expect(canonicalizeLabel('App')).toBe('App')
    expect(canonicalizeLabel('a side project')).toBe('Side project')
  })
})

describe('normalizeEntities', () => {
  it('canonicalizes, drops blanks/none/first-person, dedupes, caps at 3', () => {
    expect(
      normalizeEntities(['  the app ', 'App', 'none', 'I', 'bob', 'carol', 'dave'])
    ).toEqual(['App', 'Bob', 'Carol']) // "the app"==="App" dup, none/I dropped, capped at 3
  })
})
