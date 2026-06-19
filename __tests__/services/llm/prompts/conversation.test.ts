import {
  buildConversationMessages,
  buildSummaryMessages,
  type ConversationContext,
} from '@/services/llm/prompts/conversation'

const empty: ConversationContext = { sources: [], connections: [] }

describe('buildConversationMessages', () => {
  it('leads with a system message and ends with the user turn', () => {
    const msgs = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(msgs[0].role).toBe('system')
    expect(msgs[msgs.length - 1].role).toBe('user')
  })

  it('system prompt tells the model to engage with the message, not deflect to the wiki', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).toMatch(/respond to what the user says/i)
    expect(system.content).toMatch(/never ignore it or deflect/i)
    // It must NOT carry the old "only use the wiki / say you don't have enough" framing.
    expect(system.content).not.toMatch(/don't have enough in (their|your) wiki/i)
  })

  it('discourages ending every reply with a question', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).toMatch(/don’t end every reply with a question/i)
  })

  it('carries the reflective technique and the distortion guide (with examples) in the system prompt', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).toMatch(/reflective companion technique/i)
    expect(system.content).toMatch(/distorted-thinking patterns/i)
    expect(system.content).toMatch(/Catastrophizing/)
    expect(system.content).toMatch(/e\.g\./) // identification examples present
  })

  it('a new topic with no wiki match becomes a bare message — no background block', () => {
    const msgs = buildConversationMessages({
      history: [],
      message: 'I need to buy resources for the launch',
      context: empty,
    })
    const userTurn = msgs[msgs.length - 1].content
    expect(userTurn).toBe('I need to buy resources for the launch')
    expect(userTurn).not.toMatch(/Background from their wiki|no relevant wiki/i)
  })

  it('attaches relevant wiki as optional background AFTER the message', () => {
    const context: ConversationContext = {
      sources: [{ title: 'Work', content: 'Deadlines spike anxiety.' }],
      connections: ['Anxiety often comes up with Work.'],
    }
    const msgs = buildConversationMessages({ history: [], message: 'work is rough', context })
    const userTurn = msgs[msgs.length - 1].content
    expect(userTurn.startsWith('work is rough')).toBe(true) // message leads
    expect(userTurn).toMatch(/Background from their wiki/i)
    expect(userTurn).toMatch(/Work/)
    expect(userTurn.indexOf('work is rough')).toBeLessThan(userTurn.indexOf('Background'))
  })

  it('passes prior turns through between system and the new message', () => {
    const history = [
      { role: 'user' as const, content: 'earlier' },
      { role: 'assistant' as const, content: 'reply' },
    ]
    const msgs = buildConversationMessages({ history, message: 'now', context: empty })
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('prepends a recap of earlier turns to the system message when a summary exists', () => {
    const [system] = buildConversationMessages({
      history: [],
      message: 'hi',
      context: empty,
      summary: 'They have been worried about a work deadline.',
    })
    expect(system.content).toMatch(/recap/i)
    expect(system.content).toMatch(/worried about a work deadline/)
  })

  it('adds no recap when there is no summary', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).not.toMatch(/recap/i)
  })
})

describe('buildSummaryMessages', () => {
  it('asks the model to fold new turns into the prior recap', () => {
    const [system, user] = buildSummaryMessages({
      previousSummary: 'They felt anxious.',
      turns: [
        { role: 'user', content: 'work is rough' },
        { role: 'assistant', content: 'that sounds heavy' },
      ],
    })
    expect(system.role).toBe('system')
    expect(system.content).toMatch(/recap/i)
    expect(user.content).toMatch(/They felt anxious\./)
    expect(user.content).toMatch(/User: work is rough/)
    expect(user.content).toMatch(/Companion: that sounds heavy/)
  })

  it('notes when there is no prior recap yet', () => {
    const [, user] = buildSummaryMessages({
      previousSummary: '',
      turns: [{ role: 'user', content: 'hello' }],
    })
    expect(user.content).toMatch(/no recap yet/i)
  })
})
