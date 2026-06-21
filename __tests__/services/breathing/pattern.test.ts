import {
  BOX_CYCLE,
  CYCLES,
  cycleSeconds,
  stepAt,
  totalSeconds,
  totalSteps,
} from '@/services/breathing/pattern'

describe('box-breathing pattern', () => {
  it('is a four-phase, equal-length cycle', () => {
    expect(BOX_CYCLE.map((s) => s.phase)).toEqual(['inhale', 'hold-in', 'exhale', 'hold-out'])
    expect(BOX_CYCLE.every((s) => s.seconds === 4)).toBe(true)
    expect(cycleSeconds).toBe(16)
  })

  it('totals 5 cycles / 20 steps / 80 seconds', () => {
    expect(CYCLES).toBe(5)
    expect(totalSteps).toBe(20)
    expect(totalSeconds).toBe(80)
  })

  it('inhale grows the circle and exhale shrinks it', () => {
    const [inhale, holdIn, exhale, holdOut] = BOX_CYCLE
    expect(inhale.scale).toBeGreaterThan(exhale.scale)
    expect(holdIn.scale).toBe(inhale.scale) // hold keeps the inhaled size
    expect(holdOut.scale).toBe(exhale.scale) // hold keeps the exhaled size
  })

  it('maps a flat index to the right phase and 1-based cycle', () => {
    expect(stepAt(0)).toEqual({ step: BOX_CYCLE[0], cycle: 1 })
    expect(stepAt(4)).toEqual({ step: BOX_CYCLE[0], cycle: 2 }) // next cycle, back to inhale
    expect(stepAt(totalSteps - 1)).toEqual({ step: BOX_CYCLE[3], cycle: 5 }) // last: hold-out, cycle 5
  })
})
