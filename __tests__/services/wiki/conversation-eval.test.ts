/**
 * Reflect-conversation eval harness.
 *
 * The reflective companion is the live face of the wiki, and it's about to
 * change underneath us — a smarter retriever and a deep-model swap (Qwen2.5 3B →
 * Qwen3.5-4B). Letting a small model drive its own grounding/replies is exactly
 * the kind of change that regresses quietly: subtly longer, more questions,
 * scaffolding bleed, or clinical drift. This file is the regression net:
 *
 *  - `checkReply` is the executable definition of a "good" companion reply — the
 *    same contract the conversation SYSTEM prompt asks for (concise 2–4
 *    sentences, at most one question, no leaked wiki scaffolding, no clinical
 *    claims). It's model-independent, so a future on-device eval can score REAL
 *    model output with the exact same checker.
 *  - The fixture table runs realistic model outputs through the real `respond`
 *    pipeline (only the LLM call is mocked) and asserts the outcome — grounded in
 *    the right pages, validated, and meeting the house style.
 *
 * To extend: add a fixture. When the new model misbehaves in a new way, add a
 * raw sample here and (if needed) a rule in `checkReply`.
 */
import { buildContext, respond } from '@/services/wiki/conversation'
import { type WikiPage } from '@/services/storage/wiki'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({
  LLMBridge: { converse: jest.fn(), synthesise: jest.fn(), embed: jest.fn() },
}))
const mockConverse = LLMBridge.converse as jest.Mock

function page(title: string, content: string, over: Partial<WikiPage> = {}): WikiPage {
  return {
    id: title.toLowerCase(),
    title,
    category: 'emotion',
    content,
    entry_count: 3,
    version: 1,
    version_history: [],
    created_at: 1,
    updated_at: 1,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
    ...over,
  }
}

const PAGES = [
  page('Work anxiety', 'You tense up before meetings and replay them afterward, bracing for criticism.'),
  page('Sleep', 'You sleep poorly the night before a deadline, then feel foggy the next day.'),
]

// Count sentence-ish chunks (terminal . ! ? collapses runs like "?!").
function countSentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean).length
}
function countQuestions(text: string): number {
  return (text.match(/\?+/g) ?? []).length
}

/**
 * Returns the ways `reply` breaks the companion's house style — empty array
 * means a clean reply. Deterministic and prose-shape only, so it works on any
 * model's output. Mirrors the conversation SYSTEM prompt's rules.
 */
function checkReply(reply: string): string[] {
  const violations: string[] = []
  const text = reply.trim()

  if (text === '') return ['empty']

  // Concise: the prompt asks for 2–4 sentences. Flag runaway replies (a terse
  // 1-sentence validation is acceptable, so we don't flag short ones).
  if (countSentences(text) > 4) violations.push('too long')

  // At most one gentle question per reply.
  if (countQuestions(text) > 1) violations.push('multiple questions')

  // The wiki context is attached as background scaffolding; it must never bleed
  // into the reply the user reads.
  const SCAFFOLD = [
    /background from their wiki/i,
    /^\s*pages:\s*$/im,
    /^\s*connections:\s*$/im,
    /\[\d+\]\s/, // citation marker like "[1] Work anxiety"
    /^\s*system:/im,
  ]
  if (SCAFFOLD.some((re) => re.test(text))) violations.push('scaffolding leak')

  // No diagnosis / medical advice (narrow, high-precision net — empathetic
  // language and pointing to human support are fine).
  const CLINICAL = [
    /\byou (have|'ve got|are suffering from)\s+(depression|anxiety disorder|bipolar|ptsd|ocd|adhd)\b/i,
    /\bI('?m)?\s+(diagnos|can diagnose)/i,
    /\b(should|need to)\s+take\s+(medication|antidepressants?|an?\s+ssri)\b/i,
  ]
  if (CLINICAL.some((re) => re.test(text))) violations.push('clinical language')

  return violations
}

describe('checkReply (companion house-style contract)', () => {
  const fixtures: { name: string; reply: string; expect: string[] }[] = [
    {
      name: 'warm, grounded, no question',
      reply:
        'It sounds like that silence really got under your skin. Anyone would feel on edge waiting on a reply like that. Her quiet probably says more about how buried her week is than anything about you.',
      expect: [],
    },
    {
      name: 'one gentle question is allowed',
      reply: 'That uncertainty sounds exhausting to sit with. What do you notice in your body when you reach for your phone?',
      expect: [],
    },
    {
      name: 'runaway length',
      reply: 'One. Two. Three. Four. Five. Six.',
      expect: ['too long'],
    },
    {
      name: 'interrogating, multiple questions',
      reply: 'Why do you think she ignored you? What would help right now? Have you tried telling her?',
      expect: ['multiple questions'],
    },
    {
      name: 'leaks wiki scaffolding',
      reply: 'Background from their wiki: Pages:\n[1] Work anxiety — you tend to catastrophize before meetings.',
      expect: ['scaffolding leak'],
    },
    {
      name: 'clinical drift',
      reply: 'It really sounds like you have depression and should take medication for it.',
      expect: ['clinical language'],
    },
    { name: 'empty', reply: '   ', expect: ['empty'] },
  ]

  it.each(fixtures)('$name', ({ reply, expect: want }) => {
    expect(checkReply(reply).sort()).toEqual(want.sort())
  })
})

describe('respond pipeline (LLM mocked)', () => {
  beforeEach(() => mockConverse.mockReset())

  it('grounds in the relevant page and returns a clean reply', async () => {
    const reply =
      'It makes sense that the meeting is sitting heavy with you. You brace for these and then keep replaying them — that takes a real toll.'
    mockConverse.mockResolvedValue({ text: reply })

    const res = await respond({
      history: [],
      message: 'I am so anxious about that work meeting tomorrow',
      pages: PAGES,
      nodes: [],
      edges: [],
    })

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.sources.map((p) => p.title)).toContain('Work anxiety')
    expect(checkReply(res.data.text)).toEqual([]) // model output meets the contract
  })

  it('does not force in an unrelated page (relevance floor)', () => {
    const { sources } = buildContext('I had pancakes for breakfast', PAGES, [], [])
    expect(sources).toEqual([])
  })

  it('grounds a terse message using the recent thread (thread-aware query)', () => {
    // The latest line carries no signal on its own, but the prior user turn does.
    const history = [
      { role: 'user' as const, content: 'I keep bracing for criticism before every work meeting' },
      { role: 'assistant' as const, content: 'That sounds heavy to carry in.' },
    ]
    const lastLine = buildContext('ugh, again today', PAGES, [], [])
    expect(lastLine.sources).toEqual([]) // no history → terse line grounds nothing
    const threaded = buildContext('ugh, again today', PAGES, [], [], history)
    expect(threaded.sources.map((p) => p.title)).toContain('Work anxiety')
  })

  it('an unrelated thread still grounds nothing', () => {
    const history = [{ role: 'user' as const, content: 'we went hiking and made pancakes' }]
    const { sources } = buildContext('it was a nice weekend', PAGES, [], [], history)
    expect(sources).toEqual([])
  })

  it('fails validation on an empty model reply (no blank turn shown)', async () => {
    mockConverse.mockResolvedValue({ text: '   ' })
    const res = await respond({
      history: [],
      message: 'hello',
      pages: PAGES,
      nodes: [],
      edges: [],
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('CONVERSE_VALIDATION_FAILED')
  })
})
