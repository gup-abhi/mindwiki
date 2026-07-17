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
    expect(system.content).toMatch(/never\s+ignore it or deflect/i)
    // It must NOT carry the old "only use the wiki / say you don't have enough" framing.
    expect(system.content).not.toMatch(/don't have enough in (their|your) wiki/i)
  })

  it('defaults reply endings to a reflection, not a question', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).toMatch(/not a question/i)
  })

  it('enforces question alternation in code: previous reply asked → this one must not', () => {
    const history = [
      { role: 'user' as const, content: 'work is rough' },
      { role: 'assistant' as const, content: 'That sounds heavy. What part weighs most?' },
    ]
    const [system] = buildConversationMessages({ history, message: 'all of it', context: empty })
    expect(system.content).toMatch(/do NOT ask any question/)
  })

  it('adds no question steer when the previous reply ended without one', () => {
    const history = [
      { role: 'user' as const, content: 'work is rough' },
      { role: 'assistant' as const, content: 'That sounds heavy, and it makes sense it wears on you.' },
    ]
    const [system] = buildConversationMessages({ history, message: 'yeah', context: empty })
    expect(system.content).not.toMatch(/do NOT ask any question/)
  })

  it('injects a private helper note when the message touches a thinking pattern', () => {
    const [system] = buildConversationMessages({
      history: [],
      message: "if I send this wrong I'll get fired, it will be a disaster",
      context: empty,
    })
    expect(system.content).toMatch(/Helper notes/)
    expect(system.content).toMatch(/never mention, quote, or name/)
    expect(system.content).toMatch(/worst-case outcome/) // full catastrophizing guidance
  })

  it('injects no helper notes for a message that touches none', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).not.toMatch(/Helper notes/)
  })

  it('pins stated constraints into the system prompt when present', () => {
    const context: ConversationContext = {
      sources: [],
      connections: [],
      constraints: ["They have told you they don't have anyone to talk to. Never suggest reaching out."],
    }
    const [system] = buildConversationMessages({ history: [], message: 'i feel stuck', context })
    expect(system.content).toMatch(/Constraints the user has stated/)
    expect(system.content).toMatch(/Never suggest reaching out/)
  })

  it('adds no constraint block when there are none', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).not.toMatch(/Constraints the user has stated/)
  })

  it('carries the reflective technique but NOT the clinical distortion taxonomy', () => {
    const [system] = buildConversationMessages({ history: [], message: 'hi', context: empty })
    expect(system.content).toMatch(/reflective companion technique/i)
    // The definitions list primes interviewer-ish framing — it lives in the
    // extract prompt now, never in chat.
    expect(system.content).not.toMatch(/distorted-thinking patterns/i)
    expect(system.content).not.toMatch(/Catastrophizing:/)
  })

  it('sends ONLY real turns — tone examples live in the system prompt, never as fake history', () => {
    const history = [
      { role: 'user' as const, content: 'earlier' },
      { role: 'assistant' as const, content: 'reply' },
    ]
    const msgs = buildConversationMessages({ history, message: 'now', context: empty })
    // No injected exemplar turns: the 3B model treats history turns as this
    // user's real past and fabricates memories from them (device-verified).
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    // The quoted examples are in the system prompt, marked as not-this-user.
    expect(msgs[0].content).toMatch(/really deflating/)
    expect(msgs[0].content).toMatch(/not from this user’s life/i)
  })

  it('keeps replies reflection-only: no advice lists, and no announcing the wiki', () => {
    const context: ConversationContext = {
      sources: [{ title: 'Loneliness', content: 'Often ties to family distance.' }],
      connections: [],
    }
    const msgs = buildConversationMessages({ history: [], message: 'nobody helps me', context })
    expect(msgs[0].content).toMatch(/never give advice lists/i)
    const userTurn = msgs[msgs.length - 1].content
    expect(userTurn).toMatch(/never announce/i)
    // Pink-elephant guard: naming a forbidden phrase teaches the model the
    // phrase — the prompt must not contain it anywhere.
    expect(userTurn).not.toMatch(/given your background/i)
  })

  it('renders an unchanged retrieval as a titles-only reminder — no page prose to copy', () => {
    const context: ConversationContext = {
      sources: [],
      connections: [],
      knownTopics: ['Job hunting', 'Stress'],
    }
    const msgs = buildConversationMessages({ history: [], message: 'I don’t know.', context })
    const userTurn = msgs[msgs.length - 1].content
    expect(userTurn).toMatch(/Job hunting, Stress/)
    expect(userTurn).toMatch(/unchanged/)
    expect(userTurn).not.toMatch(/Background from their wiki/) // no full block
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

  it('passes prior turns through immediately before the new message', () => {
    const history = [
      { role: 'user' as const, content: 'earlier' },
      { role: 'assistant' as const, content: 'reply' },
    ]
    const msgs = buildConversationMessages({ history, message: 'now', context: empty })
    expect(msgs[msgs.length - 3].content).toBe('earlier')
    expect(msgs[msgs.length - 2].content).toBe('reply')
    expect(msgs[msgs.length - 1].content).toBe('now')
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
