import {
  buildUpdatePagePrompt,
  buildReGroundPrompt,
  buildRewritePagePrompt,
  buildEmotionPagePrompt,
} from '@/services/llm/prompts/update-page'
import { type EmotionAggregate } from '@/services/wiki/aggregates'

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

describe('buildReGroundPrompt', () => {
  const pastEntries = [
    { situation: 'Had a tough standup', thought: 'Everyone thinks my updates are weak', created_at: 1710000000000 },
    { situation: 'Missed a deadline', thought: 'I am unreliable', created_at: 1710100000000 },
  ]

  it('includes the re-grounding instruction line', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries })
    expect(prompt).toMatch(/Re-synthesize it based on the current page/i)
    expect(prompt).toMatch(/past entries below/i)
  })

  it('grounds in past entries as the primary evidence', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries })
    expect(prompt).toMatch(/Ground your synthesis in these as the primary evidence/i)
    expect(prompt).not.toMatch(/Weave the new reflection into the page/i)
  })

  it('formats past entries as date-keyed blocks with no labels', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries })
    expect(prompt).toMatch(/2024-03-09 —/)
    expect(prompt).toMatch(/2024-03-10 —/)
    // Past entries should NOT be rendered as labelled blocks (those leak into output).
    // The word "Situation:" appears in PAGE_STYLE as a negative example, which is fine.
    // Check instead that past entries aren't labelled in the data section:
    const pastSection = prompt.split('Past entries (newest first):')[1] ?? ''
    expect(pastSection).not.toMatch(/^Situation:/m)
    expect(pastSection).not.toMatch(/^Thought:/m)
  })

  it('does not include past-entries sections when there are none (fallback)', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries: [] })
    expect(prompt).toMatch(/past entries below/i)
    expect(prompt).not.toMatch(/newest first:\n\n/)
  })

  it('trims existing content to the tighter re-ground cap (1200 chars)', () => {
    const content = 'x'.repeat(4000)
    const prompt = buildReGroundPrompt({ ...base, existingContent: content, pastEntries })
    expect(prompt).toContain(`${'x'.repeat(1200)}…`)
    expect(prompt).not.toContain('x'.repeat(1201))
  })

  it('deduplicates past entries with identical text (keeps newest date)', () => {
    const dupe = [
      { situation: 'Same thing', thought: 'Same thought', created_at: 1710000000000 },
      { situation: 'Same thing', thought: 'Same thought', created_at: 1710100000000 },
    ]
    const prompt = buildReGroundPrompt({ ...base, pastEntries: dupe })
    // Both dates could appear if dedup failed — count occurrences of "Same thing"
    expect(prompt.match(/Same thing/g)?.length ?? 0).toBe(1)
    // The newer date should win
    expect(prompt).toMatch(/2024-03-10 —/)
  })

  it('formats the current page as a prior (not the source of truth)', () => {
    const prompt = buildReGroundPrompt({ ...base, existingContent: 'You worry about work.', pastEntries })
    expect(prompt).toMatch(/Current page \(as prior\)/)
    expect(prompt).toContain('You worry about work.')
  })

  it('still folds in the reframe line when on a belief page', () => {
    const prompt = buildReGroundPrompt({
      ...base,
      category: 'belief',
      reframe: 'I can be nervous and still capable',
      pastEntries,
    })
    expect(prompt).toMatch(/more balanced view/i)
    expect(prompt).toContain('I can be nervous and still capable')
  })

  it('includes recency hint when the page has been quiet', () => {
    const prompt = buildReGroundPrompt({
      ...base,
      existingContent: 'You worry about work.',
      weeksSinceUpdate: 5,
      pastEntries,
    })
    expect(prompt).toMatch(/roughly 5 weeks/i)
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

describe('buildUpdatePagePrompt — connection line', () => {
  it('injects the connection line as an instruction when provided', () => {
    const prompt = buildUpdatePagePrompt({
      ...base,
      connectionLine: 'Anxiety often comes up with Work, Sleep.',
    })
    expect(prompt).toMatch(/knowledge graph shows/i)
    expect(prompt).toContain('Anxiety often comes up with Work, Sleep.')
    expect(prompt).toMatch(/the page is about "Work"/i)
  })

  it('omits the connection line when not provided (back-compat)', () => {
    const prompt = buildUpdatePagePrompt(base)
    expect(prompt).not.toMatch(/knowledge graph shows/i)
  })

  it('omits the connection line when the string is empty', () => {
    const prompt = buildUpdatePagePrompt({ ...base, connectionLine: '' })
    expect(prompt).not.toMatch(/knowledge graph shows/i)
  })
})

describe('buildReGroundPrompt — connection line', () => {
  const pastEntries = [
    { situation: 'Missed a deadline', thought: 'I am unreliable', created_at: 1710100000000 },
  ]

  it('injects the connection line as an instruction in re-grounding', () => {
    const prompt = buildReGroundPrompt({
      ...base,
      connectionLine: 'Anxiety often comes up with Work.',
      pastEntries,
    })
    expect(prompt).toMatch(/knowledge graph shows/i)
    expect(prompt).toContain('Anxiety often comes up with Work.')
    expect(prompt).toMatch(/the page is about "Work"/i)
  })

  it('omits the connection line in re-grounding when not provided', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries })
    expect(prompt).not.toMatch(/knowledge graph shows/i)
  })
})

describe('buildRewritePagePrompt — connection line', () => {
  it('injects the connection line when provided', () => {
    const prompt = buildRewritePagePrompt({
      title: 'Work',
      category: 'theme',
      content: 'You stress about deadlines.',
      connectionLine: 'Work often comes up with Anxiety.',
    })
    expect(prompt).toMatch(/knowledge graph shows/i)
    expect(prompt).toContain('Work often comes up with Anxiety.')
    expect(prompt).toMatch(/the page is about "Work"/i)
  })

  it('omits the connection line when not provided (back-compat)', () => {
    const prompt = buildRewritePagePrompt({
      title: 'Work',
      category: 'theme',
      content: 'You stress about deadlines.',
    })
    expect(prompt).not.toMatch(/knowledge graph shows/i)
  })
})

describe('buildEmotionPagePrompt — connection line', () => {
  const aggregate: EmotionAggregate = {
    emotion: 'Anxiety',
    totalCount: 20,
    recentCount: { last4weeks: 8, last8weeks: 15 },
    topSituations: [{ pattern: 'work', count: 5 }],
    moodTrend: { recentAvg: 2.4, priorAvg: 2.8, direction: 'down' },
    recentExamples: [{ situation: 'work', thought: 'stress', created_at: 1710000000000 }],
  }
  const emotionBase = {
    title: 'Anxiety',
    category: 'emotion' as const,
    existingContent: '',
    data: aggregate,
    weeksSinceUpdate: null,
  }

  it('injects the connection line as an instruction when provided', () => {
    const prompt = buildEmotionPagePrompt({
      ...emotionBase,
      connectionLine: 'Anxiety often comes up with Work, Sleep.',
    })
    expect(prompt).toMatch(/knowledge graph shows/i)
    expect(prompt).toContain('Anxiety often comes up with Work, Sleep.')
    expect(prompt).toMatch(/the page is about "Anxiety"/i)
  })

  it('omits the connection line when not provided (back-compat)', () => {
    const prompt = buildEmotionPagePrompt(emotionBase)
    expect(prompt).not.toMatch(/knowledge graph shows/i)
  })

  it('omits the connection line when the string is empty', () => {
    const prompt = buildEmotionPagePrompt({ ...emotionBase, connectionLine: '' })
    expect(prompt).not.toMatch(/knowledge graph shows/i)
  })
})
