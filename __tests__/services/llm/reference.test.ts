import {
  decodeFor,
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

describe('decodeFor', () => {
  it('returns the reframe lens for a real distortion', () => {
    const out = decodeFor({ distortion: 'Catastrophizing', emotion: 'Anxiety' })
    expect(out).toContain('Catastrophizing')
    expect(out).toContain('Reframe lens:')
    expect(out).toContain('Anxiety')
  })

  it('canonicalizes a near-synonym distortion before lookup', () => {
    const out = decodeFor({ distortion: 'catastrophising' })
    expect(out).toContain('Catastrophizing')
  })

  it('returns empty when there is no distortion (none / absent / unknown)', () => {
    expect(decodeFor({ distortion: 'none', emotion: 'Joy' })).toBe('')
    expect(decodeFor({})).toBe('')
    expect(decodeFor({ distortion: 'not a real distortion' })).toBe('')
  })

  it('stays within the char cap', () => {
    const out = decodeFor({ distortion: 'All-or-nothing thinking', emotion: 'Shame' })
    expect(out.length).toBeLessThanOrEqual(400)
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
