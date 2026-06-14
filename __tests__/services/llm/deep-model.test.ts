import {
  synthesizePage,
  regeneratePage,
  synthesizePursuitDetails,
  generateCheckinQuestion,
  generateReflectionQuestion,
  generateAffirmation,
  converseFromWiki,
} from '@/services/llm/deep-model'
import { buildUpdatePagePrompt, buildRewritePagePrompt } from '@/services/llm/prompts/update-page'
import { buildPursuitDetailsPrompt } from '@/services/llm/prompts/pursuit-details'
import { buildCheckinQuestionPrompt } from '@/services/llm/prompts/checkin-question'
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
    expect(p).toMatch(/do NOT copy sentences unchanged/i) // combats verbatim echo
    expect(p).toMatch(/address the reader directly as "you"/i) // shared voice rules
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

  it('pins a consistent second-person voice and forbids first-person / definitions', () => {
    const p = buildUpdatePagePrompt(input)
    expect(p).toMatch(/address the reader directly as "you"/i)
    expect(p).toMatch(/never write in the\s+first person/i)
    expect(p).toMatch(/never write a generic dictionary definition/i)
  })

  it('does not feed parrotable Situation/Thought labels and forbids headings', () => {
    const p = buildUpdatePagePrompt(input)
    expect(p).not.toMatch(/-\s*Situation:/)
    expect(p).not.toMatch(/-\s*Thought:/)
    expect(p).toMatch(/do NOT add section headings/i)
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

describe('buildPursuitDetailsPrompt', () => {
  const input = { title: 'Marathon training', existingDetails: '', entryText: 'ran 5k today' }

  it('asks for the first version when there is no note, and includes the reflection', () => {
    const p = buildPursuitDetailsPrompt(input)
    expect(p).toContain('Marathon training')
    expect(p).toContain('ran 5k today')
    expect(p).toContain('There is no note yet')
  })

  it('includes the current note when one exists', () => {
    const p = buildPursuitDetailsPrompt({ ...input, existingDetails: 'Building toward a fall race.' })
    expect(p).toContain('Current note:')
    expect(p).toContain('Building toward a fall race.')
  })
})

describe('synthesizePursuitDetails', () => {
  beforeEach(() => mockSynthesise.mockReset())
  const input = { title: 'Marathon training', existingDetails: '', entryText: 'ran 5k today' }

  it('returns the trimmed note on success', async () => {
    mockSynthesise.mockResolvedValue({ text: '  They are training for a marathon.  ' })
    const result = await synthesizePursuitDetails(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('They are training for a marathon.')
  })

  it('fails with PURSUIT_SYNTH_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await synthesizePursuitDetails(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('PURSUIT_SYNTH_INFERENCE_FAILED')
  })

  it('fails with PURSUIT_SYNTH_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   ' })
    const result = await synthesizePursuitDetails(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('PURSUIT_SYNTH_VALIDATION_FAILED')
  })
})

describe('buildCheckinQuestionPrompt', () => {
  it('includes the title and the running note and asks for one question', () => {
    const p = buildCheckinQuestionPrompt({ title: 'Marathon training', details: 'Aiming for a fall race.' })
    expect(p).toContain('Marathon training')
    expect(p).toContain('Aiming for a fall race.')
    expect(p).toMatch(/ONE[\s\S]*question/)
  })
})

describe('generateCheckinQuestion', () => {
  beforeEach(() => mockSynthesise.mockReset())
  const input = { title: 'Marathon training', details: 'Aiming for a fall race.' }

  it('returns the trimmed question on success', async () => {
    mockSynthesise.mockResolvedValue({ text: '  How is the training feeling lately?  ' })
    const result = await generateCheckinQuestion(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('How is the training feeling lately?')
  })

  it('fails with CHECKIN_QUESTION_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await generateCheckinQuestion(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CHECKIN_QUESTION_INFERENCE_FAILED')
  })

  it('fails with CHECKIN_QUESTION_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   ' })
    const result = await generateCheckinQuestion(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CHECKIN_QUESTION_VALIDATION_FAILED')
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

