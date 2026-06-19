import {
  synthesisHint,
  distortionGuide,
  DISTORTION_REFERENCE,
  EMOTION_REFERENCE,
  REFLECTIVE_TECHNIQUES,
  FEW_SHOT,
} from '@/services/llm/reference'
import { DISTORTIONS, EMOTIONS } from '@/services/llm/taxonomy'

describe('reference coverage', () => {
  it('has a complete, well-formed entry for every canonical distortion', () => {
    for (const d of DISTORTIONS) {
      const entry = DISTORTION_REFERENCE[d]
      expect(entry).toBeDefined()
      expect(entry.name).toBe(d)
      expect(entry.definition.length).toBeGreaterThan(0)
      expect(entry.reframe.length).toBeGreaterThan(0)
      expect(entry.examples.length).toBeGreaterThanOrEqual(1)
      expect(entry.examples.every((e) => e.trim().length > 0)).toBe(true)
    }
  })

  it('has a cue for every canonical emotion', () => {
    for (const e of EMOTIONS) {
      expect(EMOTION_REFERENCE[e]?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('has reflective technique text and an even number of few-shot turns', () => {
    expect(REFLECTIVE_TECHNIQUES.length).toBeGreaterThan(0)
    expect(FEW_SHOT.length).toBeGreaterThan(0)
    expect(FEW_SHOT.length % 2).toBe(0) // user/assistant pairs
    expect(FEW_SHOT[0].role).toBe('user')
  })
})

describe('synthesisHint', () => {
  it('returns one natural-language instruction naming the pattern (no labels)', () => {
    const out = synthesisHint('Catastrophizing')
    expect(out).toContain('catastrophizing')
    // must NOT be a labelled data block — those leaked into pages
    expect(out).not.toMatch(/Reframe lens:|Thinking pattern:|Feeling:/)
    expect(out.split('\n')).toHaveLength(1)
  })

  it('canonicalizes a near-synonym distortion before lookup', () => {
    expect(synthesisHint('catastrophising')).toContain('catastrophizing')
  })

  it('returns empty when there is no distortion (none / absent / unknown)', () => {
    expect(synthesisHint('none')).toBe('')
    expect(synthesisHint(null)).toBe('')
    expect(synthesisHint(undefined)).toBe('')
    expect(synthesisHint('not a real distortion')).toBe('')
  })
})

describe('distortionGuide', () => {
  it('lists distortions with identification examples, capped in size', () => {
    const guide = distortionGuide()
    expect(guide).toContain('Catastrophizing')
    expect(guide).toContain('e.g.') // carries examples
    // terse: one line per distortion plus a header
    expect(guide.split('\n').length).toBeLessThanOrEqual(DISTORTIONS.length + 1)
  })
})
