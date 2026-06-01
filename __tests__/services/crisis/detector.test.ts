import { assessCrisis, hasCrisisKeyword } from '@/services/crisis/detector'
import { CRISIS_RESOURCES } from '@/services/crisis/resources'

const SAFE = 'I had a productive day at work and felt calm.'

describe('crisis detector', () => {
  it('maps confidence to tiers when no keyword is present', () => {
    expect(assessCrisis(SAFE, 0.1).tier).toBe(0)
    expect(assessCrisis(SAFE, 0.3).tier).toBe(1)
    expect(assessCrisis(SAFE, 0.6).tier).toBe(2)
    expect(assessCrisis(SAFE, 0.85).tier).toBe(3)
  })

  it('keyword safety net forces tier 3 even when model confidence is low', () => {
    const result = assessCrisis('I want to die', 0.05)
    expect(result.tier).toBe(3)
    expect(result.keywordMatch).toBe(true)
  })

  it('keyword matching is case-insensitive', () => {
    expect(hasCrisisKeyword('I keep thinking about SUICIDE')).toBe(true)
    expect(hasCrisisKeyword(SAFE)).toBe(false)
  })

  it('exposes crisis resources including the 988 lifeline', () => {
    expect(CRISIS_RESOURCES.length).toBeGreaterThan(0)
    expect(CRISIS_RESOURCES.some((r) => r.contact.includes('988'))).toBe(true)
  })
})
