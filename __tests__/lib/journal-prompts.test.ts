import { JOURNAL_PROMPTS, randomPrompt } from '@/lib/journal-prompts'

describe('journal prompts', () => {
  it('returns a prompt from the curated list', () => {
    expect(JOURNAL_PROMPTS).toContain(randomPrompt())
  })

  it('never returns the excluded prompt (so shuffle always changes)', () => {
    const current = JOURNAL_PROMPTS[0]
    for (let i = 0; i < 30; i++) expect(randomPrompt(current)).not.toBe(current)
  })
})
