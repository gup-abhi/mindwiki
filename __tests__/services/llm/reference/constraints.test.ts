import { detectConstraints } from '@/services/llm/reference'

describe('detectConstraints', () => {
  it('triggers no-support-network on each of its cues', () => {
    const cues = [
      'i have no one to talk to',
      'there is nobody to talk to here',
      "i don't have anyone",
      'i dont have anyone anymore',
      'i have no friends',
      'nobody to turn to',
      'no one i can talk to about it',
      "i'm all alone in this",
    ]
    for (const turn of cues) {
      const ids = detectConstraints([turn]).map((c) => c.id)
      expect(ids).toContain('no-support-network')
    }
  })

  it('triggers no-therapy-access and unsafe-family on their cues', () => {
    expect(detectConstraints(["i can't afford therapy"]).map((c) => c.id)).toContain('no-therapy-access')
    expect(detectConstraints(['there is no therapist near me']).map((c) => c.id)).toContain('no-therapy-access')
    expect(detectConstraints(["i can't talk to my family"]).map((c) => c.id)).toContain('unsafe-family')
    expect(detectConstraints(["my family wouldn't understand"]).map((c) => c.id)).toContain('unsafe-family')
  })

  it('does not trigger on mentions of people the user CAN reach', () => {
    expect(detectConstraints(['I talked to my mom today'])).toEqual([])
    expect(detectConstraints(['my friend said it would pass'])).toEqual([])
    expect(detectConstraints(['I called a therapist and booked a session'])).toEqual([])
  })

  it('dedupes a constraint that appears across multiple turns', () => {
    const turns = [
      'i have no one to talk to',
      'seriously, nobody to turn to',
      "i don't have anyone",
    ]
    const found = detectConstraints(turns)
    expect(found.filter((c) => c.id === 'no-support-network')).toHaveLength(1)
  })

  it('matches a cue at index 0 of a 20-turn history (full-history scan)', () => {
    const turns = [
      'i have no one to talk to',
      ...Array.from({ length: 19 }, (_, i) => `turn ${i} about my day`),
    ]
    const ids = detectConstraints(turns).map((c) => c.id)
    expect(ids).toContain('no-support-network')
  })

  it('returns a steer that forbids suggesting other people', () => {
    const [c] = detectConstraints(['i have no one to talk to'])
    expect(c.steer).toMatch(/never suggest reaching out/i)
  })
})
