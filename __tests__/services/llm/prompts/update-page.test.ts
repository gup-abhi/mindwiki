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

describe('buildUpdatePagePrompt — recency hint', () => {
  const withContent = { ...base, existingContent: 'You often worry about work.' }

  it('adds an evolution hint when the page has gone quiet for weeks', () => {
    const prompt = buildUpdatePagePrompt({ ...withContent, weeksSinceUpdate: 6 })
    expect(prompt).toMatch(/roughly 6 weeks since this page was last shaped/i)
    expect(prompt).toMatch(/intensified, eased, or shifted/i)
    // must guard against fabricating a timeline
    expect(prompt).toMatch(/do NOT invent specific past events/i)
  })

  it('stays silent for a recently-updated page (daily journaling)', () => {
    const prompt = buildUpdatePagePrompt({ ...withContent, weeksSinceUpdate: 1 })
    expect(prompt).not.toMatch(/since this page was last shaped/i)
  })

  it('stays silent on a first-time (empty) page even with a large gap', () => {
    const prompt = buildUpdatePagePrompt({ ...base, weeksSinceUpdate: 10 })
    expect(prompt).not.toMatch(/since this page was last shaped/i)
  })

  it('adds no hint when weeksSinceUpdate is absent (back-compat)', () => {
    const prompt = buildUpdatePagePrompt(withContent)
    expect(prompt).not.toMatch(/since this page was last shaped/i)
  })
})

describe('buildUpdatePagePrompt — existing content cap', () => {
  it('embeds a normal-sized page in full (never trimmed)', () => {
    const content = 'You often worry about work.'.repeat(20) // ~540 chars, well under cap
    const prompt = buildUpdatePagePrompt({ ...base, existingContent: content })
    expect(prompt).toContain(content)
    expect(prompt).not.toContain('…')
  })

  it('trims a page that grazes the context window', () => {
    const content = 'x'.repeat(4000) // schema ceiling; would push the prompt past n_ctx
    const prompt = buildUpdatePagePrompt({ ...base, existingContent: content })
    expect(prompt).toContain(`${'x'.repeat(2400)}…`)
    expect(prompt).not.toContain('x'.repeat(2401))
  })
})
