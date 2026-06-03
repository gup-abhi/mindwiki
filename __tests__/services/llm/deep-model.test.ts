import { synthesizePage, generateReflectionQuestion, answerFromWiki } from '@/services/llm/deep-model'
import { buildUpdatePagePrompt } from '@/services/llm/prompts/update-page'
import { buildDigestQuestionPrompt } from '@/services/llm/prompts/digest-question'
import { buildAnswerQuestionPrompt } from '@/services/llm/prompts/answer-question'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({ LLMBridge: { synthesise: jest.fn() } }))

const mockSynthesise = LLMBridge.synthesise as jest.Mock

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

describe('buildAnswerQuestionPrompt', () => {
  it('embeds the sources and the question, and restricts to the wiki', () => {
    const p = buildAnswerQuestionPrompt({
      question: 'What stresses me at work?',
      sources: [{ title: 'Work', content: 'Deadlines spike anxiety.' }],
    })
    expect(p).toContain('Work')
    expect(p).toContain('Deadlines spike anxiety.')
    expect(p).toContain('What stresses me at work?')
    expect(p).toMatch(/ONLY the personal wiki pages/)
  })
})

describe('answerFromWiki', () => {
  beforeEach(() => mockSynthesise.mockReset())
  const aInput = { question: 'q?', sources: [{ title: 'Work', content: 'text' }] }

  it('returns the trimmed answer on success', async () => {
    mockSynthesise.mockResolvedValue({ text: '  Deadlines tend to spike it.  ' })
    const result = await answerFromWiki(aInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('Deadlines tend to spike it.')
  })

  it('fails with WIKI_ANSWER_INFERENCE_FAILED when the model throws', async () => {
    mockSynthesise.mockRejectedValue(new Error('OOM'))
    const result = await answerFromWiki(aInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('WIKI_ANSWER_INFERENCE_FAILED')
  })

  it('fails with WIKI_ANSWER_VALIDATION_FAILED on empty output', async () => {
    mockSynthesise.mockResolvedValue({ text: '   ' })
    const result = await answerFromWiki(aInput)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('WIKI_ANSWER_VALIDATION_FAILED')
  })
})
