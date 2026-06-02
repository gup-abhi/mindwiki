import { reengagement } from '@/services/notifications/re-engagement'

const day = (d: number): number => new Date(2026, 5, d, 12).getTime() // June d, noon

describe('reengagement', () => {
  const now = day(30)

  it('returns none when there is no prior entry', () => {
    expect(reengagement(null, now)).toEqual({ tier: 'none', message: null })
  })

  it('returns none for fewer than 3 days of silence', () => {
    expect(reengagement(day(28), now).tier).toBe('none') // 2 days
  })

  it('returns d3 for 3–6 days of silence', () => {
    expect(reengagement(day(27), now).tier).toBe('d3') // 3 days
    expect(reengagement(day(24), now).tier).toBe('d3') // 6 days
  })

  it('returns d7 for 7–29 days of silence', () => {
    expect(reengagement(day(23), now).tier).toBe('d7') // 7 days
    expect(reengagement(day(1), now).tier).toBe('d7') // 29 days
  })

  it('returns d30 for 30+ days of silence', () => {
    expect(reengagement(new Date(2026, 4, 1, 12).getTime(), now).tier).toBe('d30')
  })

  it('attaches a non-empty message for every active tier', () => {
    expect(reengagement(day(27), now).message).toBeTruthy()
    expect(reengagement(day(23), now).message).toBeTruthy()
    expect(reengagement(new Date(2026, 4, 1).getTime(), now).message).toBeTruthy()
  })
})
