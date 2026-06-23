import { buildUpdatePagePrompt } from '@/services/llm/prompts/update-page'

const base = {
  title: 'Work',
  category: 'emotion' as const,
  existingContent: '',
  situation: 'Big deadline tomorrow',
  thought: 'If I get this wrong I will be fired',
}

describe('buildUpdatePagePrompt — KB grounding', () => {
  it('adds a single natural-language hint for a tagged distortion (no labelled block)', () => {
    const prompt = buildUpdatePagePrompt({ ...base, distortion: 'Catastrophizing' })
    expect(prompt).toMatch(/tends toward catastrophizing/i)
    // the old labelled decode block (which leaked into pages) must be gone
    expect(prompt).not.toMatch(/Reframe lens:|Thinking pattern:|Feeling:|do NOT define these terms/i)
  })

  it('adds no hint when the entry has no distortion', () => {
    const prompt = buildUpdatePagePrompt({ ...base, distortion: 'none' })
    expect(prompt).not.toMatch(/tends toward/i)
  })

  it('works with no distortion field at all (back-compat)', () => {
    const prompt = buildUpdatePagePrompt(base)
    expect(prompt).toMatch(/personal wiki page titled "Work"/)
    expect(prompt).not.toMatch(/tends toward/i)
  })

  it('folds in the writer’s reframe as an instruction (belief pages)', () => {
    const prompt = buildUpdatePagePrompt({
      ...base,
      category: 'belief',
      reframe: 'I can be nervous and still capable',
    })
    expect(prompt).toMatch(/more balanced view/i)
    expect(prompt).toContain('I can be nervous and still capable')
    expect(prompt).toMatch(/revising this belief/i)
  })

  it('adds no reframe line when there is no reframe', () => {
    const prompt = buildUpdatePagePrompt(base)
    expect(prompt).not.toMatch(/more balanced view/i)
  })
})
