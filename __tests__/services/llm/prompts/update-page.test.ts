import { buildUpdatePagePrompt } from '@/services/llm/prompts/update-page'

const base = {
  title: 'Work',
  category: 'emotion' as const,
  existingContent: '',
  situation: 'Big deadline tomorrow',
  thought: 'If I get this wrong I will be fired',
}

describe('buildUpdatePagePrompt — decode lens', () => {
  it('injects a guarded reframe lens for a tagged distortion', () => {
    const prompt = buildUpdatePagePrompt({ ...base, distortion: 'Catastrophizing', emotion: 'Anxiety' })
    expect(prompt).toMatch(/Reframe lens:/)
    expect(prompt).toMatch(/Catastrophizing/)
    // guarded: must tell the model NOT to define the term in the page
    expect(prompt).toMatch(/do NOT define these terms/i)
  })

  it('injects nothing when the entry has no distortion', () => {
    const prompt = buildUpdatePagePrompt({ ...base, distortion: 'none', emotion: 'Anxiety' })
    expect(prompt).not.toMatch(/Reframe lens:/)
    expect(prompt).not.toMatch(/do NOT define these terms/i)
  })

  it('still works with no tags at all (back-compat)', () => {
    const prompt = buildUpdatePagePrompt(base)
    expect(prompt).toMatch(/personal wiki page titled "Work"/)
    expect(prompt).not.toMatch(/Reframe lens:/)
  })
})
