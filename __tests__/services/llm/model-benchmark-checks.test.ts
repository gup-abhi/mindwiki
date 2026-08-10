import { checkReflectReply, checkWikiHouseStyle } from '@/services/llm/dev/model-benchmark-checks'

describe('model benchmark style checks', () => {
  it('keeps the wiki house-style rules', () => {
    expect(checkWikiHouseStyle('You tend to brace before meetings.')).toEqual([])
    expect(checkWikiHouseStyle('I am anxious.')).toContain('first-person voice')
    expect(checkWikiHouseStyle('## Work\nYou tense up.')).toContain('markdown heading')
    expect(checkWikiHouseStyle('Situation: a meeting')).toContain('section label')
  })

  it('keeps the Reflect reply safety and style rules', () => {
    expect(checkReflectReply('That sounds like a lot to carry before the meeting.')).toEqual([])
    expect(checkReflectReply('What happened? What will you do?')).toContain('multiple questions')
    expect(checkReflectReply('Background from their wiki: Pages:\n[1] Work')).toContain('scaffolding leak')
    expect(checkReflectReply('You have depression and should take medication.')).toContain('clinical language')
    expect(checkReflectReply('You should talk to a friend about this.')).toContain('deflection')
  })
})
