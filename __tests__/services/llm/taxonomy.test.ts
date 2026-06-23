import {
  canonicalizeEmotion,
  canonicalizeDistortion,
  canonicalizeLabel,
  singularizeLabel,
  normalizeEntities,
  normalizePhrases,
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

describe('singularizeLabel', () => {
  it('collapses common plurals so near-duplicate topics merge to one page', () => {
    expect(singularizeLabel('Relationships')).toBe('Relationship')
    expect(singularizeLabel('relationships')).toBe('relationship')
    expect(singularizeLabel('Feelings')).toBe('Feeling')
    expect(singularizeLabel('Boundaries')).toBe('Boundary') // -ies → -y
    expect(singularizeLabel('Finances')).toBe('Finance')
  })

  it('only touches the last word of a multi-word topic', () => {
    expect(singularizeLabel('Work relationships')).toBe('Work relationship')
    expect(singularizeLabel('Job hunting')).toBe('Job hunting') // not plural
  })

  it('leaves already-singular and ambiguous words untouched (precision over recall)', () => {
    for (const w of ['Stress', 'Sadness', 'Status', 'Crisis', 'Focus']) {
      expect(singularizeLabel(w)).toBe(w)
    }
    // ambiguous sibilant "-es" (house/stress shape) — left rather than mangled
    expect(singularizeLabel('Wishes')).toBe('Wishes')
    expect(singularizeLabel('Boxes')).toBe('Boxes')
    // too short to risk
    expect(singularizeLabel('Is')).toBe('Is')
  })
})

describe('normalizePhrases', () => {
  it('trims, strips trailing punctuation, capitalizes, dedupes, drops none, caps at 2', () => {
    expect(
      normalizePhrases([
        '  i am not good enough. ',
        'I am not good enough', // dup (case/punctuation)
        'none',
        'I have to be perfect',
        'People will leave', // 3rd → dropped by cap
      ])
    ).toEqual(['I am not good enough', 'I have to be perfect'])
  })

  it('keeps the full phrase — no leading-article strip (unlike normalizeEntities)', () => {
    expect(normalizePhrases(['my worth depends on others'])).toEqual([
      'My worth depends on others',
    ])
  })
})
