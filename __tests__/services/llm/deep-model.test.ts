import {
  synthesizePage,
  regeneratePage,
  generateReflectionQuestion,
  generateAffirmation,
  converseFromWiki,
  extractEntry,
  suggestBalancedThought,
  deepenReflection,
} from '@/services/llm/deep-model'
import { buildUpdatePagePrompt, buildRewritePagePrompt } from '@/services/llm/prompts/update-page'
import { buildAffirmationPrompt } from '@/services/llm/prompts/affirmation'
import { buildDigestQuestionPrompt } from '@/services/llm/prompts/digest-question'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({
  LLMBridge: { synthesise: jest.fn(), converse: jest.fn() },
}))

const mockSynthesise = LLMBridge.synthesise as jest.Mock
const mockConverse = LLMBridge.converse as jest.Mock

const input = {
  title: 'Anxiety',
  category: 'emotion',
  existingContent: '',
  situation: 'a meeting',
  thought: 'I will fail',
}

describe('buildRewritePagePrompt', () => {
  it('asks to keep substance, pins the voice, and includes the page to rewrite', () => {
    const p = buildRewritePagePrompt({ title: 'Anxiety', category: 'emotion', content: 'I always panic.' })
    expect(p).toMatch(/Keep the SAME facts and meaning/i)
    expect(p).toMatch(/do NOT copy sentences/i) // combats verbatim echo
    expect(p).toMatch(/DELETE any "Situation", "Thought"/i) // strips the CBT skeleton
    expect(p).toMatch(/consolidated/i) // shared house style
    expect(p).toContain('I always panic.') // the existing content is fed in
  })
})

describe('regeneratePage', () => {
  it('returns the rewritten content on success', async () => {
    mockSynthesise.mockResolvedValue({ text: 'You tend to expect the worst before meetings.' })
    const res = await regeneratePage({ title: 'Anxiety', category: 'emotion', content: 'old' })
    expect(res.success && res.data).toBe('You tend to expect the worst before meetings.')
  })

  it('returns REGEN_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('no model'))
    const res = await regeneratePage({ title: 'Anxiety', category: 'emotion', content: 'old' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('REGEN_INFERENCE_FAILED')
  })
})

describe('buildUpdatePagePrompt', () => {
  it('asks for first version when content is empty and includes the entry', () => {
    const p = buildUpdatePagePrompt(input)
    expect(p).toContain('write the first version')
    expect(p).toContain('a meeting')
    expect(p).toContain('Anxiety')
  })

  it('includes current content when present', () => {
    const p = buildUpdatePagePrompt({ ...input, existingContent: 'prior text' })
    expect(p).toContain('Current page:')
    expect(p).toContain('prior text')
  })

  it('pins a consolidated second-person house style (no labels, no first person)', () => {
    const p = buildUpdatePagePrompt(input)
    expect(p).toMatch(/consolidated/i)
    expect(p).toMatch(/address the reader directly as "you"/i)
    expect(p).toMatch(/never write in the\s+first person/i)
    expect(p).toMatch(/Never use labels or section headings/i)
  })

  it('does not feed parrotable Situation/Thought labels into the reflection', () => {
    const p = buildUpdatePagePrompt(input)
    expect(p).not.toMatch(/-\s*Situation:/)
    expect(p).not.toMatch(/-\s*Thought:/)
    // both pieces of the reflection are still present for the model to synthesize
    expect(p).toContain('a meeting')
    expect(p).toContain('I will fail')
  })
})

describe('synthesizePage', () => {
  beforeEach(() => mockSynthesise.mockReset())

  it('returns trimmed content on success', async () => {
    mockSynthesise.mockResolvedValue({ text: '  ## Anxiety\nYou notice it before meetings.  ' })
    const result = await synthesizePage(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('## Anxiety\nYou notice it before meetings.')
  })

  it('fails with SYNTH_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await synthesizePage(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('SYNTH_INFERENCE_FAILED')
  })

  it('fails with SYNTH_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   ' })
    const result = await synthesizePage(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('SYNTH_VALIDATION_FAILED')
  })
})

describe('converseFromWiki', () => {
  beforeEach(() => mockConverse.mockReset())
  const cInput = { history: [], message: 'hi', context: { sources: [], connections: [] } }

  it('accepts a long multi-paragraph reply (regression: the 800-char cap rejected valid replies)', async () => {
    const long = 'a'.repeat(1000) // well over the old 800 cap, within the 220-token budget
    mockConverse.mockResolvedValue({ text: long })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.length).toBe(1000)
  })

  it('fails with CONVERSE_INFERENCE_FAILED when the model throws', async () => {
    mockConverse.mockRejectedValue(new Error('OOM'))
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('CONVERSE_INFERENCE_FAILED')
  })

  it('fails with CONVERSE_VALIDATION_FAILED on empty output', async () => {
    mockConverse.mockResolvedValue({ text: '   ' })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('CONVERSE_VALIDATION_FAILED')
  })

  it('trims a budget-clipped reply back to the last whole sentence', async () => {
    mockConverse.mockResolvedValue({
      text: 'That sounds heavy. You carried it anyway. Remember that every moment is a chance to learn and grow, even if it',
    })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That sounds heavy. You carried it anyway.')
  })

  it('leaves a reply that ends cleanly untouched', async () => {
    mockConverse.mockResolvedValue({ text: 'It makes sense that stung. What usually steadies you?' })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('It makes sense that stung. What usually steadies you?')
  })

  it('scrubs sentences that announce the wiki background', async () => {
    mockConverse.mockResolvedValue({
      text: 'That sounds exhausting. Given your background, it’s clear you’ve been through a lot. You kept going anyway.',
    })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That sounds exhausting. You kept going anyway.')
  })

  it('replaces a question-only reply when the previous reply already asked one', async () => {
    const input = {
      ...cInput,
      history: [{ role: 'assistant' as const, content: 'What feels hardest right now?' }],
    }
    mockConverse.mockResolvedValue({ text: 'What would help?' })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).not.toMatch(/\?$/)
  })

  it('strips a trailing question when the previous reply already asked one', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'work is rough' },
        { role: 'assistant' as const, content: 'That sounds heavy. What part weighs most?' },
      ],
    }
    mockConverse.mockResolvedValue({
      text: 'It makes sense you feel stuck. That takes real persistence. What else have you considered?',
    })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('It makes sense you feel stuck. That takes real persistence.')
  })

  it('strips a trailing question split on a `!` boundary (WS1.2: guard is the single source of truth)', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'work is rough' },
        { role: 'assistant' as const, content: 'That sounds heavy. What part weighs most?' },
      ],
    }
    // The old respond-level guard split only on '.', so it left this question in
    // place. sentencesOf splits on '!' too, so the deep-model guard drops it.
    mockConverse.mockResolvedValue({ text: 'That sounds hard! What happened next?' })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That sounds hard!')
  })

  it('allows a question when the previous reply did not ask one', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'work is rough' },
        { role: 'assistant' as const, content: 'That sounds heavy, and it makes sense it wears on you.' },
      ],
    }
    mockConverse.mockResolvedValue({ text: 'That’s a lot to carry. What usually helps?' })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That’s a lot to carry. What usually helps?')
  })

  it('suppresses a recycled sentence from before the trimmed window via priorReplies (WS2.D)', async () => {
    // `history` (trimmed window) has no assistant turn echoing the reflection,
    // but `priorReplies` carries one from earlier in the conversation. The guard
    // must drop the recycled first sentence and keep the new second one.
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'still no job' },
        { role: 'assistant' as const, content: 'You kept going anyway.' },
      ],
      priorReplies: ['This cycle of rejection doesn’t define your worth or your future.'],
    }
    mockConverse.mockResolvedValue({
      text: 'This cycle of rejection doesn’t define your worth. Something new came up.',
    })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('Something new came up.')
  })

  it('drops a sentence the companion already said, even reworded', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'still no job' },
        {
          role: 'assistant' as const,
          content:
            'It’s important to remember that this cycle of rejection doesn’t define your worth or your future.',
        },
      ],
    }
    mockConverse.mockResolvedValue({
      // First sentence = near-verbatim recycle of the prior reply; second is new.
      text: 'This cycle of rejection doesn’t define your worth. Something in you kept applying anyway.',
    })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('Something in you kept applying anyway.')
  })

  it('regenerates once, hotter, when the whole reply is recycled', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'still no job' },
        { role: 'assistant' as const, content: 'This cycle of rejection doesn’t define your worth or your future.' },
      ],
    }
    mockConverse
      .mockResolvedValueOnce({ text: 'This cycle of rejection doesn’t define your worth or your future.' })
      .mockResolvedValueOnce({ text: 'That “nothing is working” feeling is its own kind of exhaustion.' })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data).toBe('That “nothing is working” feeling is its own kind of exhaustion.')
    }
    expect(mockConverse).toHaveBeenCalledTimes(2)
    expect(mockConverse.mock.calls[1][1].temperature).toBe(0.8) // hotter retry
  })

  it('drops an advice-deflection sentence, keeping the reflection (WS2.B)', async () => {
    mockConverse.mockResolvedValue({ text: 'That sounds heavy. Maybe talk to a friend about it.' })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That sounds heavy.')
  })

  it('keeps a reply that is entirely deflection (never-empty fallback)', async () => {
    mockConverse.mockResolvedValue({ text: 'Have you considered seeing a therapist?' })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    // Whole reply matched → dropping all would be empty, so keep it as-is.
    if (res.success) expect(res.data).toBe('Have you considered seeing a therapist?')
  })

  it('leaves a reply with validation and no deflection unchanged', async () => {
    mockConverse.mockResolvedValue({ text: 'That really stings. You have been carrying a lot.' })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That really stings. You have been carrying a lot.')
  })

  it('drops deflection paraphrases but keeps first-person presence (WS2.B)', async () => {
    mockConverse.mockResolvedValue({
      text: 'I hear you. Reaching out to somebody might help. Open up to your family. I’m here to talk with you.',
    })
    const res = await converseFromWiki(cInput)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('I hear you. I’m here to talk with you.')
  })

  it('holds a deflection sentence in the stream gate — never emitted to onToken (WS2.B)', async () => {
    const full = 'That sounds so lonely. Maybe reach out to a friend about it. You have held this a while.'
    mockConverse.mockImplementation(async (_m: unknown, _o: unknown, cb?: (t: string) => void) => {
      for (let i = 0; i < full.length; i += 6) cb?.(full.slice(i, i + 6))
      return { text: full }
    })
    const onToken = jest.fn()
    const res = await converseFromWiki(cInput, onToken)
    // Normalize inter-sentence whitespace: each streamed sentence carries its own
    // trailing space, so dropping the middle one leaves a cosmetic double space.
    const streamed = onToken.mock.calls.map((c) => c[0]).join('').replace(/\s+/g, ' ').trim()
    expect(streamed).toBe('That sounds so lonely. You have held this a while.')
    // The deflection sentence never reached the UI.
    expect(streamed).not.toMatch(/reach out to a friend/i)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('That sounds so lonely. You have held this a while.')
  })

  it('streams only sentences that survive cleanup — shown text never retracts', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'still no job' },
        {
          role: 'assistant' as const,
          content:
            'It’s important to remember that this cycle of rejection doesn’t define your worth or your future. What part weighs most?',
        },
      ],
    }
    const full =
      'This cycle of rejection doesn’t define your worth. Something in you kept applying anyway. What might tomorrow look like?'
    mockConverse.mockImplementation(async (_m: unknown, _o: unknown, cb?: (t: string) => void) => {
      // stream in arbitrary chunks that cross sentence boundaries
      for (let i = 0; i < full.length; i += 7) cb?.(full.slice(i, i + 7))
      return { text: full }
    })
    const onToken = jest.fn()

    const res = await converseFromWiki(input, onToken)

    const streamed = onToken.mock.calls.map((c) => c[0]).join('').trim()
    // repeat sentence dropped; trailing question held back (previous reply asked)
    expect(streamed).toBe('Something in you kept applying anyway.')
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe('Something in you kept applying anyway.')
  })

  it('releases a held question once a later sentence shows it is not trailing', async () => {
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'still no job' },
        { role: 'assistant' as const, content: 'That sounds heavy. What part weighs most?' },
      ],
    }
    const full = 'What would rest even look like? You already know part of the answer.'
    mockConverse.mockImplementation(async (_m: unknown, _o: unknown, cb?: (t: string) => void) => {
      for (let i = 0; i < full.length; i += 5) cb?.(full.slice(i, i + 5))
      return { text: full }
    })
    const onToken = jest.fn()

    const res = await converseFromWiki(input, onToken)

    const streamed = onToken.mock.calls.map((c) => c[0]).join('').trim()
    expect(streamed).toBe(full) // mid-reply question kept, in order
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe(full)
  })

  it('serves the retry text even if it is still recycled — never a dead turn', async () => {
    const recycled = 'This cycle of rejection doesn’t define your worth or your future.'
    const input = {
      ...cInput,
      history: [
        { role: 'user' as const, content: 'still no job' },
        { role: 'assistant' as const, content: recycled },
      ],
    }
    mockConverse.mockResolvedValue({ text: recycled })
    const res = await converseFromWiki(input)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toBe(recycled)
    expect(mockConverse).toHaveBeenCalledTimes(2)
  })
})

describe('buildAffirmationPrompt', () => {
  it('includes the challenge, its length, and asks for one first-person line', () => {
    const p = buildAffirmationPrompt({ title: 'Work out', details: '20 min', targetDays: 30 })
    expect(p).toContain('Work out')
    expect(p).toContain('30-day')
    expect(p).toContain('20 min')
    expect(p).toMatch(/ONE[\s\S]*affirmation/)
  })
})

describe('generateAffirmation', () => {
  beforeEach(() => mockSynthesise.mockReset())
  const aInput = { title: 'Work out', details: '', targetDays: 30 }

  it('returns the affirmation, stripping wrapping quotes', async () => {
    mockSynthesise.mockResolvedValue({ text: '  "I am someone who shows up."  ' })
    const result = await generateAffirmation(aInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('I am someone who shows up.')
  })

  it('fails with AFFIRMATION_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await generateAffirmation(aInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('AFFIRMATION_INFERENCE_FAILED')
  })

  it('fails with AFFIRMATION_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   ' })
    const result = await generateAffirmation(aInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('AFFIRMATION_VALIDATION_FAILED')
  })
})

describe('buildDigestQuestionPrompt', () => {
  it('includes the aggregated pattern and correlation, asks for one question', () => {
    const p = buildDigestQuestionPrompt({ pattern: 'mostly anxiety', correlation: 'low days carried dread' })
    expect(p).toContain('mostly anxiety')
    expect(p).toContain('low days carried dread')
    expect(p).toMatch(/ONE[\s\S]*question/)
  })
})

describe('generateReflectionQuestion', () => {
  beforeEach(() => mockSynthesise.mockReset())
  const qInput = { pattern: 'mostly anxiety', correlation: 'low days carried dread' }

  it('returns the trimmed question on success', async () => {
    mockSynthesise.mockResolvedValue({ text: '  What helps you feel grounded?  ' })
    const result = await generateReflectionQuestion(qInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('What helps you feel grounded?')
  })

  it('fails with DIGEST_QUESTION_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await generateReflectionQuestion(qInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('DIGEST_QUESTION_INFERENCE_FAILED')
  })

  it('fails with DIGEST_QUESTION_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   ' })
    const result = await generateReflectionQuestion(qInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('DIGEST_QUESTION_VALIDATION_FAILED')
  })
})

describe('deepenReflection', () => {
  beforeEach(() => mockSynthesise.mockReset())
  const dInput = { prompt: 'What’s weighing on you?', answer: 'Work has been relentless.' }

  it('returns the first line with wrapping quotes stripped', async () => {
    mockSynthesise.mockResolvedValue({ text: '"What part of it feels heaviest?"\n\n(hope this helps)' })
    const result = await deepenReflection(dInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('What part of it feels heaviest?')
  })

  it('fails with DEEPEN_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await deepenReflection(dInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('DEEPEN_INFERENCE_FAILED')
  })

  it('fails with DEEPEN_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   \n ' })
    const result = await deepenReflection(dInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('DEEPEN_VALIDATION_FAILED')
  })
})

describe('extractEntry', () => {
  const exInput = { situation: 'building the app brought me joy', thought: '' }

  it('canonicalizes emotion/distortion and the topic + entity labels', async () => {
    mockSynthesise.mockResolvedValue({
      text:
        '{"emotion":"joyful","distortion":"none","distortion_confidence":0.0,"mood_score":0.9,' +
        '"topics":["the app"],"people":[],"places":[],"activities":["the app"," me "]}',
    })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.emotion).toBe('Joy') // snapped via alias
      expect(result.data.distortion).toBe('none')
      expect(result.data.mood_score).toBe(0.9)
      expect(result.data.topics).toEqual(['App']) // "the app" -> "App"
      expect(result.data.activities).toEqual(['App']) // "the app" canon, "me" dropped
    }
  })

  it('drops a low-confidence distortion to "none" but keeps the emotion', async () => {
    mockSynthesise.mockResolvedValue({
      text:
        '{"emotion":"Anxiety","distortion":"Catastrophizing","distortion_confidence":0.3,' +
        '"mood_score":0.2,"topics":["Work"]}',
    })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.distortion).toBe('none')
      expect(result.data.emotion).toBe('Anxiety')
    }
  })

  it('normalizes extracted beliefs and behaviors (and defaults them to [])', async () => {
    mockSynthesise.mockResolvedValue({
      text:
        '{"emotion":"Anxiety","distortion":"none","distortion_confidence":0.0,"mood_score":0.3,' +
        '"topics":["Work"],"beliefs":["i am not good enough.","none"],"behaviors":["  avoidance "]}',
    })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.beliefs).toEqual(['I am not good enough']) // capitalized, trailing '.'/'none' dropped
      expect(result.data.behaviors).toEqual(['Avoidance'])
    }
  })

  it('defaults beliefs/behaviors to [] when the model omits them', async () => {
    mockSynthesise.mockResolvedValue({
      text: '{"emotion":"Anxiety","distortion":"none","distortion_confidence":0.0,"mood_score":0.3,"topics":["Work"]}',
    })
    const result = await extractEntry(exInput)
    expect(result.success && result.data.beliefs).toEqual([])
    expect(result.success && result.data.behaviors).toEqual([])
  })

  it('fails with EXTRACT_PARSE_FAILED when the model returns no JSON', async () => {
    mockSynthesise.mockResolvedValue({ text: 'I think this is anxiety.' })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('EXTRACT_PARSE_FAILED')
  })
})

describe('suggestBalancedThought', () => {
  const reframeInput = { belief: 'I am not good enough', evidenceFor: 'I froze', evidenceAgainst: 'I shipped it' }
  beforeEach(() => mockSynthesise.mockReset())

  it('returns the first line with wrapping quotes stripped', async () => {
    mockSynthesise.mockResolvedValue({ text: '"I can be nervous and still capable."\n\n— hope that helps' })
    const result = await suggestBalancedThought(reframeInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('I can be nervous and still capable.')
  })

  it('fails validation when the model returns only whitespace', async () => {
    mockSynthesise.mockResolvedValue({ text: '   \n  ' })
    const result = await suggestBalancedThought(reframeInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('REFRAME_VALIDATION_FAILED')
  })

  it('fails with REFRAME_INFERENCE_FAILED when inference throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await suggestBalancedThought(reframeInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('REFRAME_INFERENCE_FAILED')
  })
})

describe('synthesizePage — scaffolding strip', () => {
  it('accepts a clean, prose page unchanged', async () => {
    mockSynthesise.mockResolvedValue({ text: 'You tend to brace for the worst before a deadline.' })
    const result = await synthesizePage(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('You tend to brace for the worst before a deadline.')
  })

  it('strips echoed scaffolding lines, keeping the real prose (repairs a leaked page)', async () => {
    mockSynthesise.mockResolvedValue({
      text:
        'For your understanding only — do NOT define these terms:\n' +
        'Thinking pattern: All-or-nothing thinking — seeing extremes.\n' +
        'Reframe lens: where is the middle ground?\n' +
        'Current page:\n' +
        'You tend to see your life as total success or total failure.',
    })
    const result = await synthesizePage(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('You tend to see your life as total success or total failure.')
      expect(result.data).not.toMatch(/Reframe lens:|Thinking pattern:|Current page:|for your understanding/i)
    }
  })

  it('fails validation when the output was nothing but scaffolding', async () => {
    mockSynthesise.mockResolvedValue({ text: 'Current page:\nNew reflection:' })
    const result = await synthesizePage(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('SYNTH_VALIDATION_FAILED')
  })
})

