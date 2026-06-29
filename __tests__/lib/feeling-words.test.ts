import { quadrantFor, feelingsForAffect, QUADRANT_FEELINGS } from '@/lib/feeling-words'

describe('quadrantFor', () => {
  it('maps the four corners to their quadrants', () => {
    expect(quadrantFor(5, 5)).toBe('pleasantHigh')
    expect(quadrantFor(5, 1)).toBe('pleasantLow')
    expect(quadrantFor(1, 5)).toBe('unpleasantHigh')
    expect(quadrantFor(1, 1)).toBe('unpleasantLow')
  })

  it('treats the middle band of either axis as neutral', () => {
    expect(quadrantFor(3, 5)).toBe('neutral') // mid pleasantness
    expect(quadrantFor(5, 3)).toBe('neutral') // mid energy
    expect(quadrantFor(3, 3)).toBe('neutral')
  })
})

describe('feelingsForAffect', () => {
  it('returns the quadrant words once both axes are set', () => {
    expect(feelingsForAffect(4, 5)).toBe(QUADRANT_FEELINGS.pleasantHigh)
    expect(feelingsForAffect(2, 1)).toBe(QUADRANT_FEELINGS.unpleasantLow)
  })

  it('returns nothing until both axes are set', () => {
    expect(feelingsForAffect(null, 5)).toHaveLength(0)
    expect(feelingsForAffect(4, null)).toHaveLength(0)
  })
})
