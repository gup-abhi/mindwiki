// TDD tests for F-03: pure normalizeTopics step + atomic truncation counter.
// Required behavior:
//   - Case-insensitive dedupe BEFORE taking the cap (so 'Work' + 'work' + 'Marriage'
//     becomes ['Work', 'Marriage'], not one topic).
//   - Returns { topics, truncated } so the pipeline can decide whether to
//     increment the count-only diagnostic without re-walking the input.
//   - Truncated = true ONLY when rawTopics had more distinct (case-insensitive)
//     values than the cap. Duplicates or fewer-than-cap inputs do not trigger.
//   - Missing/malformed (empty/whitespace/non-string) inputs do not throw and
//     return empty topics with truncated=false.

import { normalizeTopics } from '@/services/pipeline'

describe('F-03.1 — case-insensitive dedupe BEFORE cap', () => {
  it("preserves 'Work' + 'Marriage' from ['Work', 'work', 'Marriage']", () => {
    const out = normalizeTopics(['Work', 'work', 'Marriage'], 2)
    expect(out.topics).toEqual(['Work', 'Marriage'])
    // 'work' was a duplicate of 'Work', not a distinct third theme → NOT truncated.
    expect(out.truncated).toBe(false)
  })

  it('keeps first-occurrence casing', () => {
    const out = normalizeTopics(['WORK', 'Work', 'marriage', 'MARRIAGE'], 2)
    expect(out.topics).toEqual(['WORK', 'marriage'])
  })
})

describe('F-03.2 — truncation flag', () => {
  it('marks truncated when distinct count > cap', () => {
    const out = normalizeTopics(['A', 'B', 'C'], 2)
    expect(out.topics).toEqual(['A', 'B'])
    expect(out.truncated).toBe(true)
  })

  it('does NOT mark truncated when distinct count == cap', () => {
    const out = normalizeTopics(['A', 'B'], 2)
    expect(out.topics).toEqual(['A', 'B'])
    expect(out.truncated).toBe(false)
  })

  it('does NOT mark truncated when distinct count < cap', () => {
    const out = normalizeTopics(['A'], 2)
    expect(out.topics).toEqual(['A'])
    expect(out.truncated).toBe(false)
  })

  it('dedupe-before-cap: 3 values where 2 collide still NOT truncated', () => {
    // Distinct count = 2, equal to cap → not truncated even though input length = 3.
    const out = normalizeTopics(['A', 'a', 'B'], 2)
    expect(out.topics).toEqual(['A', 'B'])
    expect(out.truncated).toBe(false)
  })
})

describe('F-03.3 — malformed input is tolerated', () => {
  it('empty array → empty topics, not truncated', () => {
    const out = normalizeTopics([], 2)
    expect(out.topics).toEqual([])
    expect(out.truncated).toBe(false)
  })

  it('whitespace-only entries are dropped (treated as missing)', () => {
    const out = normalizeTopics(['  ', 'Work', '', '   '], 2)
    expect(out.topics).toEqual(['Work'])
    expect(out.truncated).toBe(false)
  })

  it('non-string entries are dropped (no throw)', () => {
    const out = normalizeTopics(['Work', null, undefined, 123, 'Marriage'] as any, 2)
    expect(out.topics).toEqual(['Work', 'Marriage'])
  })
})

describe('F-03.4 — cap respects configured limit', () => {
  it('caps at 1 when max=1', () => {
    const out = normalizeTopics(['A', 'B', 'C'], 1)
    expect(out.topics).toEqual(['A'])
    expect(out.truncated).toBe(true)
  })

  it('default cap of 2', () => {
    const out = normalizeTopics(['A', 'B', 'C'])
    expect(out.topics).toEqual(['A', 'B'])
    expect(out.truncated).toBe(true)
  })
})
