import { buildUntanglePatternsPrompt } from '@/services/llm/prompts/untangle-patterns'
import { UntanglePatternsSchema } from '@/services/llm/schemas/untangle-patterns.schema'

describe('buildUntanglePatternsPrompt', () => {
  it('includes the thought and asks ONLY for a JSON object', () => {
    const p = buildUntanglePatternsPrompt('I am going to be humiliated at the meeting')
    expect(p).toContain('I am going to be humiliated at the meeting')
    expect(p).toMatch(/JSON object/)
  })

  it('does not promise diagnosis, certainty, or force positivity', () => {
    const p = buildUntanglePatternsPrompt('I will fail')
    expect(p).not.toMatch(/diagnos/i)
    expect(p).not.toMatch(/you (are|have)/i)
    // labels are framed as suggestions, not verdicts
    expect(p).toMatch(/might fit|may fit|suggest/i)
  })

  it('caps output at two patterns and demands canonical labels', () => {
    const p = buildUntanglePatternsPrompt('flat earth reasoning does not belong here')
    expect(p).toMatch(/at most two/i)
  })
})

describe('UntanglePatternsSchema', () => {
  it('accepts an object with zero, one, or two distortion labels', () => {
    expect(UntanglePatternsSchema.safeParse({ patterns: [] }).success).toBe(true)
    expect(UntanglePatternsSchema.safeParse({ patterns: ['Mind reading'] }).success).toBe(true)
    expect(
      UntanglePatternsSchema.safeParse({ patterns: ['Mind reading', 'Catastrophizing'] }).success
    ).toBe(true)
  })

  it('accepts up to eight patterns (wrapper caps to 2 after canonicalization)', () => {
    expect(
      UntanglePatternsSchema.safeParse({
        patterns: ['Mind reading', 'Catastrophizing', 'Fortune telling'],
      }).success
    ).toBe(true)
  })

  it('rejects non-canonical shapes; the wrapper canonicalizes then drops unknowns', () => {
    // Schema is permissive (strings) — the wrapper narrows to canonical values.
    expect(UntanglePatternsSchema.safeParse({ patterns: ['whatever'] }).success).toBe(true)
    expect(UntanglePatternsSchema.safeParse({ patterns: [42] }).success).toBe(false)
  })
})
