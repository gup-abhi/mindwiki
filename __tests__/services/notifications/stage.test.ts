import { streakStage } from '@/services/notifications/stage'

describe('streakStage', () => {
  it('shows the start variant at 0', () => {
    expect(streakStage(0).variant).toBe('start')
  })

  it('shows the building (Day N) variant for 1–6', () => {
    expect(streakStage(1).variant).toBe('building')
    expect(streakStage(1).headline).toContain('Day 1')
    expect(streakStage(6).variant).toBe('building')
  })

  it('shows the week variant for 7–29', () => {
    expect(streakStage(7).variant).toBe('week')
    expect(streakStage(29).variant).toBe('week')
    expect(streakStage(7).headline).toContain('7-day streak')
  })

  it('shows the month variant for 30+', () => {
    expect(streakStage(30).variant).toBe('month')
    expect(streakStage(100).variant).toBe('month')
  })
})
