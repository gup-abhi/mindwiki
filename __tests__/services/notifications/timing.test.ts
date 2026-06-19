import {
  DEFAULT_SEND_HOUR,
  emptyHistogram,
  recordActivity,
  reminderHour,
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

  it('falls back to the default hour until enough evening data accrues', () => {
    let h = emptyHistogram()
    h = recordActivity(h, at(19))
    h = recordActivity(h, at(19))
    expect(reminderHour(h)).toBe(DEFAULT_SEND_HOUR) // only 2 evening samples
  })

  it('returns the peak evening hour once enough data exists', () => {
    let h = emptyHistogram()
    h = recordActivity(h, at(18))
    h = recordActivity(h, at(18))
    h = recordActivity(h, at(18))
    expect(reminderHour(h)).toBe(18)
  })

  it('picks the earliest evening hour on a tie', () => {
    let h = emptyHistogram()
    h = recordActivity(h, at(18))
    h = recordActivity(h, at(18))
    h = recordActivity(h, at(20))
    h = recordActivity(h, at(20))
    expect(reminderHour(h)).toBe(18)
  })

  it('ignores after-midnight peaks — a night-owl still gets the evening default', () => {
    let h = emptyHistogram()
    for (let i = 0; i < 5; i++) h = recordActivity(h, at(1)) // 1am peak
    expect(reminderHour(h)).toBe(DEFAULT_SEND_HOUR) // not 1am
  })

  it('ignores daytime peaks outside the evening window', () => {
    let h = emptyHistogram()
    for (let i = 0; i < 5; i++) h = recordActivity(h, at(9)) // 9am peak
    expect(reminderHour(h)).toBe(DEFAULT_SEND_HOUR)
  })
})
