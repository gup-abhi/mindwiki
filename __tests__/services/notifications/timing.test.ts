import {
  DEFAULT_SEND_HOUR,
  emptyHistogram,
  optimalHour,
  recordActivity,
} from '@/services/notifications/timing'

const at = (h: number): number => new Date(2026, 5, 1, h, 0).getTime()

describe('timing', () => {
  it('starts empty (24 zero slots)', () => {
    const h = emptyHistogram()
    expect(h).toHaveLength(24)
    expect(h.every((c) => c === 0)).toBe(true)
  })

  it('records activity by local hour without mutating the input', () => {
    const h0 = emptyHistogram()
    const h1 = recordActivity(h0, at(9))
    expect(h1[9]).toBe(1)
    expect(h0[9]).toBe(0) // original untouched
  })

  it('falls back to the default hour until minSamples is reached', () => {
    let h = emptyHistogram()
    h = recordActivity(h, at(7))
    h = recordActivity(h, at(7))
    expect(optimalHour(h)).toBe(DEFAULT_SEND_HOUR) // only 2 samples
  })

  it('returns the peak hour once enough data exists', () => {
    let h = emptyHistogram()
    h = recordActivity(h, at(21))
    h = recordActivity(h, at(21))
    h = recordActivity(h, at(9))
    expect(optimalHour(h)).toBe(21)
  })

  it('picks the earliest hour on a tie', () => {
    let h = emptyHistogram()
    h = recordActivity(h, at(8))
    h = recordActivity(h, at(8))
    h = recordActivity(h, at(19))
    h = recordActivity(h, at(19))
    expect(optimalHour(h)).toBe(8)
  })
})
