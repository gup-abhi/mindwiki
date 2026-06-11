import {
  synthesizePage,
  generateReflectionQuestion,
  converseFromWiki,
} from '@/services/llm/deep-model'
import { buildUpdatePagePrompt } from '@/services/llm/prompts/update-page'
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

