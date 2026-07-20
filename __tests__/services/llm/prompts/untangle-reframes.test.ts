import { buildUntangleReframePrompt } from '@/services/llm/prompts/untangle-reframe'
import { UntangleReframeSchema } from '@/services/llm/schemas/untangle-reframe.schema'

const SAMPLE = {
  thought: 'I will be humiliated at the meeting',
  patterns: ['Mind reading', 'Catastrophizing'] as const,
  sources: [
    { title: 'Work', excerpt: 'You often feel anxious before presentations at work.' },
  ],
}

describe('buildUntangleReframePrompt', () => {
  it('includes the thought, selected patterns, and source excerpts', () => {
    const p = buildUntangleReframePrompt(SAMPLE)
    expect(p).toContain('I will be humiliated at the meeting')
    expect(p).toContain('Mind reading')
    expect(p).toContain('Catastrophizing')
    expect(p).toContain('You often feel anxious before presentations at work.')
  })

  it('requests exactly three real alternatives keyed factual / gentle / action without placeholder scaffolding', () => {
    const p = buildUntangleReframePrompt(SAMPLE)
    expect(p).toMatch(/factual/i)
    expect(p).toMatch(/gentle/i)
    expect(p).toMatch(/action/i)
    expect(p).toMatch(/do not use placeholders/i)
    expect(p).not.toContain('factual: ...')
    expect(p).not.toContain('gentle: ...')
    expect(p).not.toContain('action: ...')
  })

  it('forbids diagnosis, fabricated events/sources, and forced positivity', () => {
    const p = buildUntangleReframePrompt(SAMPLE)
    expect(p).toMatch(/do not diagnose/i)
    expect(p).toMatch(/do not.*invent/i)
    expect(p).toMatch(/do not.*force positivity/i)
  })

  it('bounds long thought and evidence to preserve room for completion', () => {
    const p = buildUntangleReframePrompt({
      thought: 't'.repeat(2_000),
      patterns: ['Mind reading', 'Catastrophizing', 'Labeling'],
      sources: [
        { title: 'One', excerpt: 'a'.repeat(1_000) },
        { title: 'Two', excerpt: 'b'.repeat(1_000) },
        { title: 'Three', excerpt: 'c'.repeat(1_000) },
      ],
    })
    expect(p.length).toBeLessThan(1_300)
    expect(p).toContain('…')
    expect(p).not.toContain('Three')
  })
})

describe('UntangleReframeSchema', () => {
  it('accepts exactly three distinct, bounded, non-empty alternatives', () => {
    const good = {
      factual: 'I do not know what others think of me.',
      gentle: 'It is okay to feel nervous; feelings are not facts.',
      action: 'I can take a breath and prepare one thing.',
    }
    expect(UntangleReframeSchema.safeParse(good).success).toBe(true)
  })

  it('rejects missing keys', () => {
    expect(UntangleReframeSchema.safeParse({ factual: 'a', gentle: 'b' }).success).toBe(false)
  })

  it('rejects empty strings', () => {
    expect(
      UntangleReframeSchema.safeParse({ factual: '', gentle: 'b', action: 'c' }).success
    ).toBe(false)
  })

  it('rejects duplicate alternatives', () => {
    expect(
      UntangleReframeSchema.safeParse({
        factual: 'same',
        gentle: 'same',
        action: 'different',
      }).success
    ).toBe(false)
  })

  it('rejects overlong alternatives', () => {
    const long = 'x'.repeat(250)
    expect(
      UntangleReframeSchema.safeParse({ factual: long, gentle: 'b', action: 'c' }).success
    ).toBe(false)
  })
})
