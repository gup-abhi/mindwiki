import { REMINDER_COPY, reminderCopy } from '@/services/notifications/copy'

describe('reminder copy', () => {
  it('has 12 unique, non-empty variants', () => {
    expect(REMINDER_COPY).toHaveLength(12)
    expect(new Set(REMINDER_COPY).size).toBe(12)
    expect(REMINDER_COPY.every((c) => c.trim().length > 0)).toBe(true)
  })

  it('rotates through every variant and wraps', () => {
    const seen = Array.from({ length: 12 }, (_, i) => reminderCopy(i))
    expect(new Set(seen).size).toBe(12)
    expect(reminderCopy(12)).toBe(reminderCopy(0))
  })

  it('never repeats on consecutive days', () => {
    for (let i = 0; i < 24; i++) {
      expect(reminderCopy(i)).not.toBe(reminderCopy(i + 1))
    }
  })

  it('handles negative day indices', () => {
    expect(reminderCopy(-1)).toBe(REMINDER_COPY[11])
  })
})
