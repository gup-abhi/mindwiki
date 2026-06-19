import {
  synthesizePage,
  regeneratePage,
  generateReflectionQuestion,
  generateAffirmation,
  converseFromWiki,
  extractEntry,
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

describe('extractEntry', () => {
  const exInput = { situation: 'building the app brought me joy', thought: '' }

  it('canonicalizes emotion/distortion and the topic + entity labels', async () => {
    mockSynthesise.mockResolvedValue({
      text:
        '{"emotion":"joyful","distortion":"none","distortion_confidence":0.0,"mood_score":0.9,' +
        '"topic":"the app","people":[],"places":[],"activities":["the app"," me "]}',
    })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.emotion).toBe('Joy') // snapped via alias
      expect(result.data.distortion).toBe('none')
      expect(result.data.mood_score).toBe(0.9)
      expect(result.data.topic).toBe('App') // "the app" -> "App"
      expect(result.data.activities).toEqual(['App']) // "the app" canon, "me" dropped
    }
  })

  it('drops a low-confidence distortion to "none" but keeps the emotion', async () => {
    mockSynthesise.mockResolvedValue({
      text:
        '{"emotion":"Anxiety","distortion":"Catastrophizing","distortion_confidence":0.3,' +
        '"mood_score":0.2,"topic":"Work"}',
    })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.distortion).toBe('none')
      expect(result.data.emotion).toBe('Anxiety')
    }
  })

  it('fails with EXTRACT_PARSE_FAILED when the model returns no JSON', async () => {
    mockSynthesise.mockResolvedValue({ text: 'I think this is anxiety.' })
    const result = await extractEntry(exInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('EXTRACT_PARSE_FAILED')
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

