import {
  buildUpdatePagePrompt,
  buildReGroundPrompt,
  buildRewritePagePrompt,
  buildEmotionPagePrompt,
} from '@/services/llm/prompts/update-page'
import { estimatePromptTokens, PROMPT_INPUT_BUDGET, truncateMiddle } from '@/services/llm/prompts/budget'
import { computeTiming } from '@/services/wiki/engine'
import { type EmotionAggregate } from '@/services/wiki/aggregates'

// The deep model context is 2048 tokens; PROMPT_INPUT_BUDGET is the maximum
// estimated/measured INPUT the rendered prompt may occupy (context − output
// reserve − safety margin). Prompts that exceed it context-shift and drop
// instructions.

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
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 42, entryAgeDays: 42, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).toMatch(/roughly 6 weeks since this page was last shaped/i)
    expect(prompt).toMatch(/intensified, eased, or shifted/i)
    // must guard against fabricating a timeline
    expect(prompt).toMatch(/do NOT invent specific past events/i)
  })

  it('stays silent for a recently-updated page (daily journaling)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 7, entryAgeDays: 7, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).not.toMatch(/since this page was last shaped/i)
  })

  it('stays silent on a first-time (empty) page even with a large gap', () => {
    const prompt = buildUpdatePagePrompt({
      ...base,
      timing: { gapDays: 70, entryAgeDays: 70, isHistoricalEntry: false, isFutureEntry: false },
    })
    // No prior content => no "page went quiet" evolution framing can apply —
    // even when the entry has been sitting ~10 weeks before today's processing.
    expect(prompt).not.toMatch(/since this page was last shaped/i)
  })

  it('adds no hint when timing is absent (back-compat / first-time pages)', () => {
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

  it('trims existing content when it would push the prompt over budget (F-3A)', () => {
    // Long enough to actually exceed PROMPT_INPUT_BUDGET tokens alone.
    const content = 'PRIORHEAD'.repeat(1) + 'z z z ' + 'x '.repeat(6000) // ~12k chars => ~3000 tokens
    const prompt = buildReGroundPrompt({ ...base, existingContent: content, pastEntries })
    expect(prompt).toContain('…')
    expect(prompt).toContain('PRIORHEAD') // head kept
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
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
      timing: { gapDays: 35, entryAgeDays: 35, isHistoricalEntry: false, isFutureEntry: false },
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

  it('trims a page that would overrun the budget, keeping its head (F-3A)', () => {
    // Way beyond budget; the head line ('You often worry…') must survive.
    const content = 'You often worry about deadlines. ' + 'x '.repeat(6000)
    const prompt = buildUpdatePagePrompt({ ...base, existingContent: content })
    expect(prompt).toContain('You often worry about deadlines.')
    expect(prompt).toContain('…')
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })
})

describe('buildUpdatePagePrompt — behavior evidence (F-1)', () => {
  it('folds behavior in as natural context when present (no leaky heading)', () => {
    const prompt = buildUpdatePagePrompt({ ...base, behavior: 'I stepped outside for a walk' })
    expect(prompt).toContain('I stepped outside for a walk')
    // Behavior must NOT be introduced as a label/heading that could leak into output
    expect(prompt).not.toMatch(/^Behavior:/m)
    expect(prompt).not.toMatch(/Behavior:\s/i)
  })

  it('omits behavior entirely when null', () => {
    const prompt = buildUpdatePagePrompt({ ...base, behavior: null })
    // base.situation appears; any unrelated behavior token should not
    expect(prompt).not.toMatch(/stepped outside/i)
  })

  it('omits behavior when it is empty or whitespace-only', () => {
    const prompt = buildUpdatePagePrompt({ ...base, behavior: '   ' })
    expect(prompt).not.toMatch(/stepped outside/i)
    // whitespace-only behavior must not introduce a stray label
    expect(prompt).not.toMatch(/^\s+$/m)
  })
})

describe('buildReGroundPrompt — behavior evidence (F-1)', () => {
  const pastWithBehavior = [
    { situation: 'Had a tough standup', thought: 'Everyone doubts me', behavior: 'I stayed silent', created_at: 1710000000000 },
    { situation: 'Missed a deadline', thought: 'I am unreliable', behavior: null, created_at: 1710100000000 },
  ]

  it('includes historical behavior in past-entry evidence when present', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries: pastWithBehavior })
    const pastSection = prompt.split('Past entries (newest first):')[1] ?? ''
    expect(pastSection).toContain('I stayed silent')
  })

  it('omits historical behavior tokens when absent (no stray label)', () => {
    const onlyBehaviorless = [
      { situation: 'Missed a deadline', thought: 'I am unreliable', behavior: null, created_at: 1710100000000 },
    ]
    const prompt = buildReGroundPrompt({ ...base, pastEntries: onlyBehaviorless })
    const pastSection = prompt.split('Past entries (newest first):')[1] ?? ''
    // No "Behavior:" label should be introduced in the past-entries data block
    expect(pastSection).not.toMatch(/Behavior:/i)
  })
})

describe('buildEmotionPagePrompt — behavior in recent examples (F-1)', () => {
  it('renders recent examples with behavior when present', () => {
    const data: EmotionAggregate = {
      emotion: 'Anxiety',
      totalCount: 20,
      recentCount: { last4weeks: 8, last8weeks: 15 },
      topSituations: [{ pattern: 'work', count: 5 }],
      moodTrend: { recentAvg: 2.4, priorAvg: 2.8, direction: 'down' },
      recentExamples: [
        { situation: 'a tense meeting', thought: 'I am failing', behavior: 'I excused myself', closing_note: null, created_at: 1710000000000 },
      ],
    }
    const prompt = buildEmotionPagePrompt({
      title: 'Anxiety', category: 'emotion', existingContent: '', data, timing: null,
    })
    expect(prompt).toContain('I excused myself')
    expect(prompt).not.toMatch(/Behavior:/i)
  })

  it('renders recent examples with closing note when present', () => {
    const data: EmotionAggregate = {
      emotion: 'Anxiety',
      totalCount: 20,
      recentCount: { last4weeks: 8, last8weeks: 15 },
      topSituations: [{ pattern: 'work', count: 5 }],
      moodTrend: { recentAvg: 2.4, priorAvg: 2.8, direction: 'down' },
      recentExamples: [
        { situation: 'a tense meeting', thought: 'I am failing', behavior: null, closing_note: 'It may be hard but I can handle it', created_at: 1710000000000 },
      ],
    }
    const prompt = buildEmotionPagePrompt({
      title: 'Anxiety', category: 'emotion', existingContent: '', data, timing: null,
    })
    expect(prompt).toContain('It may be hard but I can handle it')
    expect(prompt).not.toMatch(/Closing note:/i)
  })
})

describe('connection-line instruction removed from synthesis prompts', () => {
  // Connections now render as a deterministic structured block (WikiConnections),
  // never woven into LLM prose. None of the page-synthesis builders should ever
  // produce the "knowledge graph shows" or "often comes up with" scaffolding
  // — that's the leak we're closing.
  it('buildUpdatePagePrompt never injects the knowledge graph line', () => {
    const prompt = buildUpdatePagePrompt(base)
    expect(prompt).not.toMatch(/knowledge graph shows/i)
    expect(prompt).not.toMatch(/often comes up with/i)
  })

  const pastEntries = [
    { situation: 'Missed a deadline', thought: 'I am unreliable', created_at: 1710100000000 },
  ]

  it('buildReGroundPrompt never injects the knowledge graph line', () => {
    const prompt = buildReGroundPrompt({ ...base, pastEntries })
    expect(prompt).not.toMatch(/knowledge graph shows/i)
    expect(prompt).not.toMatch(/often comes up with/i)
  })

  it('buildRewritePagePrompt never injects the knowledge graph line', () => {
    const prompt = buildRewritePagePrompt({
      title: 'Work',
      category: 'theme',
      content: 'You stress about deadlines.',
    })
    expect(prompt).not.toMatch(/knowledge graph shows/i)
    expect(prompt).not.toMatch(/often comes up with/i)
  })

  const aggregate: EmotionAggregate = {
    emotion: 'Anxiety',
    totalCount: 20,
    recentCount: { last4weeks: 8, last8weeks: 15 },
    topSituations: [{ pattern: 'work', count: 5 }],
    moodTrend: { recentAvg: 2.4, priorAvg: 2.8, direction: 'down' },
    recentExamples: [{ situation: 'work', thought: 'stress', behavior: null, closing_note: null, created_at: 1710000000000 }],
  }
  const emotionBase = {
    title: 'Anxiety',
    category: 'emotion' as const,
    existingContent: '',
    data: aggregate,
    timing: null,
  }

  it('buildEmotionPagePrompt never injects the knowledge graph line', () => {
    const prompt = buildEmotionPagePrompt(emotionBase)
    expect(prompt).not.toMatch(/knowledge graph shows/i)
    expect(prompt).not.toMatch(/often comes up with/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// F-3A — Prompt budget
// ════════════════════════════════════════════════════════════════════════════

describe('estimatePromptTokens — conservative across scripts (F-3A)', () => {
  // The estimator must be HONEST: a deliberately conservative upper bound on
  // the real tokenizer count, so prompt-renderers that trim to the estimate
  // never overflow the real context. (It is NOT exact token counting — there is
  // no lightweight tokenizer available at pure prompt-build time, so we
  // over-estimate and trim earlier than strictly necessary. The plan forbids
  // calling this +/-10% accurate.)
  it('counts ASCII words/punct via whitespace + Latin-token heuristic', () => {
    const n = estimatePromptTokens('You worry about work deadlines and meetings.')
    // 7 words, ~40 chars → estimate must be positive and bounded.
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(40)
  })

  it('counts CJK generously (every ~2 code points ≥ 1 token, never undercounts)', () => {
    // Heavily-inflected multibyte script: a Qwen BPE may merge some, but the
    // conservative estimate must NEVER go below ~1 token per ~2 chars.
    const cjk = '你经常常担心工作和会议并且感到焦虑.'.repeat(20)
    const n = estimatePromptTokens(cjk)
    expect(n).toBeGreaterThanOrEqual(cjk.length / 2)
  })

  it('counts mixed Latin+CJK at the sum of both estimates (no undercount of either)', () => {
    const mixed = 'You say 你很好 but the work 会议 makes you 焦虑.'
    const latin = 'You say  but the work  makes you .'
    const cjk = '你很好会议焦虑'
    const nMixed = estimatePromptTokens(mixed)
    const nLatin = estimatePromptTokens(latin)
    const nCjk = estimatePromptTokens(cjk)
    expect(nMixed).toBeGreaterThanOrEqual(Math.max(nLatin, nCjk))
  })

  it('counts emoji as their own grapheme clusters (not as single ASCII chars)', () => {
    // ZWJ emoji sequences are several code points but render as one grapheme.
    // The estimator should NOT collapse the whole emoji to a sub-1-token fraction.
    const emoji = 'I feel 😤 about the meeting 👍🏽 today.'
    const nEmoji = estimatePromptTokens(emoji)
    const nPlain = estimatePromptTokens('I feel  about the meeting  today.')
    expect(nEmoji).toBeGreaterThan(nPlain)
  })

  it('counts pure punctuation meaningfully (a run of ",,," is not free)', () => {
    const punct = '.,.,.,.,.,.,.,.,.,.,'
    expect(estimatePromptTokens(punct)).toBeGreaterThan(2)
  })
})

describe('truncateMiddle — head & tail preserved, middle dropped (F-3A)', () => {
  it('keeps the leading and trailing run and inserts an explicit ellipsis', () => {
    const big = 'HEAD. '.repeat(40) + 'MIDDLE NOISE. '.repeat(200) + 'TAIL END.'
    const out = truncateMiddle(big, 100)
    expect(out.startsWith('HEAD.')).toBe(true)
    expect(out.endsWith('TAIL END.')).toBe(true)
    expect(out).toContain('…')
    // The middle noise must be dropped (not just truncated at the head)
    expect(out.match(/MIDDLE NOISE/g)?.length ?? 0).toBeLessThan(200)
  })

  it('returns the input untouched when already under the ceiling', () => {
    const s = 'short string under the ceiling'
    expect(truncateMiddle(s, 1000)).toBe(s)
  })

  it('never splits a Unicode surrogate pair or a combining-mark cluster', () => {
    // A two-code-unit emoji 👍🏽 (base + skin-tone modifier) must not be cut.
    // A repeated emoji run; truncate tightly and verify no orphaned surrogate
    // (String.fromCodePoint of a split pair would produce ).
    const s = '👍🏽'.repeat(80) + 'tail'
    const out = truncateMiddle(s, 40)
    // No lone high/low surrogate halves in the output (would be malformed UTF-16).
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i)
      // Lone low surrogate (DC00–DFFF) at i===0, or a low surrogate not preceded
      // by a high surrogate, is a code-point split.
      if (c >= 0xdc00 && c <= 0xdfff) {
        if (i === 0 || out.charCodeAt(i - 1) < 0xd800 || out.charCodeAt(i - 1) > 0xdbff) {
          throw new Error('split emoji code point at ' + i)
        }
      }
    }
    expect(out).toContain('…')
  })
})

describe('full prompts live within the input budget (F-3A T-3.1)', () => {
  it('a normal update prompt stays under PROMPT_INPUT_BUDGET tokens', () => {
    const prompt = buildUpdatePagePrompt({
      ...base,
      existingContent: 'You often worry about work and deadlines.' + ' x'.repeat(200),
      distortion: 'Catastrophizing',
      timing: { gapDays: 42, entryAgeDays: 42, isHistoricalEntry: false, isFutureEntry: false },
      behavior: 'I stepped outside for a walk to cool off and breathe.',
      closingNote: 'I can be nervous and still capable and prepared.',
    })
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })

  it('a re-ground prompt stays under PROMPT_INPUT_BUDGET tokens', () => {
    const pastEntries = Array.from({ length: 20 }, (_, i) => ({
      situation: `Situation number ${i} with a moderately long description here to stress the budget`,
      thought: `Thought ${i} about being unreliable and worried the team will notice the pattern`,
      behavior: `I did the thing anyway and logged it`,
      closingNote: `Even short of confidence I can keep going`,
      created_at: 1710000000000 + i * 86400000,
    }))
    const prompt = buildReGroundPrompt({
      ...base,
      existingContent: 'You worry about work.' + ' x'.repeat(200),
      distortion: 'Catastrophizing',
      timing: { gapDays: 35, entryAgeDays: 35, isHistoricalEntry: false, isFutureEntry: false },
      pastEntries,
    })
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })

  it('an emotion aggregate prompt stays under PROMPT_INPUT_BUDGET tokens', () => {
    const data: EmotionAggregate = {
      emotion: 'Anxiety',
      totalCount: 120,
      recentCount: { last4weeks: 30, last8weeks: 60 },
      topSituations: Array.from({ length: 8 }, (_, i) => ({ pattern: `trigger ${i}`, count: 20 - i })),
      moodTrend: { recentAvg: 2.4, priorAvg: 2.8, direction: 'down' },
      recentExamples: Array.from({ length: 10 }, (_, i) => ({
        situation: `a tense meeting about the ${i}th deadline`,
        thought: `I am failing at everything in sight`,
        behavior: 'I excused myself and took a walk outside to cool off and breathe',
        closing_note: 'I can be anxious and still handle the meeting when I go back in',
        created_at: 1710000000000 + i * 86400000,
      })),
    }
    const prompt = buildEmotionPagePrompt({
      title: 'Anxiety', category: 'emotion',
      existingContent: 'You experience anxiety as a constant hum.' + ' x'.repeat(200),
      data, timing: { gapDays: 28, entryAgeDays: 0, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })
})

describe('truncation preserves instructions + current reflection (F-3A T-3.2)', () => {
  // Head and tail are SHORT and unique. The mid-marker is placed in the
  // geometric middle of a long padding run, so a head/tail trim that keeps
  // ~half-head + ~half-tail never reaches it — it lives in the dropped middle.
  const oversizedPrior =
    'HEAD START Q '.repeat(4) + // ~52 chars of unique head
    'pad '.repeat(750) + // ~3000 chars of padding (head half of trim window)
    'UNIQUE_MID_xyz '.repeat(1) + // mid marker in the true middle of the body
    'pad '.repeat(750) + // ~3000 chars of padding (tail half of trim window)
    ' TAIL END Z'

  it('English: oversized prior is head+tail trimmed; instructions + reflection intact', () => {
    const prompt = buildUpdatePagePrompt({
      ...base,
      existingContent: oversizedPrior,
      situation: 'CURRENT REFLECTION SITUATION',
      thought: 'CURRENT REFLECTION THOUGHT',
    })
    // Instructions survive
    expect(prompt).toMatch(/Output ONLY the page content, no preamble/i)
    // Current reflection survives
    expect(prompt).toContain('CURRENT REFLECTION SITUATION')
    expect(prompt).toContain('CURRENT REFLECTION THOUGHT')
    // The prior was trimmed: the head/tail anchor text survives...
    expect(prompt).toContain('HEAD START Q')
    expect(prompt).toContain('TAIL END Z')
    // ...the mid markers (placed inside the long padding) are gone...
    expect(prompt).not.toContain('UNIQUE_MID_xyz')
    // ...and so is most of the padding body. An ellipsis bridges head+tail.
    expect(prompt).toContain('…')
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })

  it('CJK: oversized prior is trimmed; instructions + reflection intact and no code-point split', () => {
    // Short unique head + tail; the mid marker sits in the geometric middle of
    // a long padding run, so head+tail trim keeps ~half-head + ~half-tail and
    // drops the middle (where the marker lives). Padding is itself CJK to
    // also stress the code-point split guard against multi-byte characters.
    const cjkPrior = '头标。'.repeat(8) + '中间填充。'.repeat(750) +
      '唯一中间符。'.repeat(1) + '中间填充。'.repeat(750) + '尾标结束。'
    const prompt = buildUpdatePagePrompt({
      ...base,
      existingContent: cjkPrior,
      situation: '当前反思情境',
      thought: '当前反思想法',
    })
    expect(prompt).toMatch(/Output ONLY the page content, no preamble/i)
    expect(prompt).toContain('当前反思情境')
    expect(prompt).toContain('当前反思想法')
    expect(prompt).toContain('头标')
    expect(prompt).toContain('尾标结束')
    // The mid marker (placed in the geometric middle) is dropped.
    expect(prompt).not.toContain('唯一中间符')
    expect(prompt).toContain('…')
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET * 6)
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })

  it('mixed text + emoji: oversized prior trimmed; reflection intact', () => {
    const midToken = 'UNIQUE_MID_MARKER_zzz '
    // Mid marker sits in the geometric middle of a long padding body so the
    // head/tail trim never reaches it. Body uses mixed CJK + emoji to exercise
    // the grapheme-safe cut.
    const mixedPrior =
      'Head 你好 '.repeat(4) +
      '杂项内容 '.repeat(300) +
      midToken +
      '杂项内容 '.repeat(300) +
      'tail 😤👍🏽 END.'
    const prompt = buildUpdatePagePrompt({
      ...base,
      existingContent: mixedPrior,
      situation: 'SITUATION here 😤',
      thought: 'THOUGHT here 👍🏽',
    })
    expect(prompt).toContain('SITUATION here 😤')
    expect(prompt).toContain('THOUGHT here 👍🏽')
    expect(prompt).toContain('Head 你好')
    expect(prompt).toContain('tail')
    // The mid marker (placed in the geometric middle) is dropped.
    expect(prompt).not.toContain('UNIQUE_MID_MARKER_zzz')
    expect(prompt).toContain('…')
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })
})

describe('re-ground trims the prior before dropping historical samples (F-3A)', () => {
  // Re-ground preservation order (plan): instructions → current reflection →
  // historical past-entries → existing page prior. So an oversized prior is
  // trimmed (head+tail) FIRST; only if that's not enough are past-entries
  // reduced while preserving timeline spread.
  it('keeps all past entries when the prior alone supplies enough trimmable slack', () => {
    const pastEntries = [
      { situation: 'Early entry', thought: 'first thought', created_at: 1710000000000 },
      { situation: 'Later entry', thought: 'second thought', created_at: 1710200000000 },
    ]
    const bigPrior = 'PRIOR HEAD. '.repeat(10) + 'z '.repeat(800) + 'PRIOR TAIL.'
    const prompt = buildReGroundPrompt({
      ...base, existingContent: bigPrior, pastEntries,
    })
    expect(prompt).toContain('Early entry')
    expect(prompt).toContain('Later entry')
    expect(prompt).toContain('PRIOR HEAD')
    expect(prompt).toContain('PRIOR TAIL')
    expect(estimatePromptTokens(prompt)).toBeLessThanOrEqual(PROMPT_INPUT_BUDGET)
  })
})

describe('F-4 time-accurate recency wording (TimingContext)', () => {
  // The wiki engine computes deterministic TimingContext inputs (calendar-day
  // arithmetic); the prompt owns the wording. Tests inject values directly — no
  // wall clock, no Date.now — per the F-4 spec.
  const withContent = { ...base, existingContent: 'You often worry about work.' }

  it('same-local-day entry may use "today" (entryAgeDays === 0)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 5, entryAgeDays: 0, isHistoricalEntry: false, isFutureEntry: false },
    })
    // Same-day entries may say "today"; entries from any other day must not.
    expect(prompt).toMatch(/today/i)
  })

  it('a freshly-old entry (3 days ago) stays silent — under the recency floor (daily journalers must not be curated into "days ago" prose)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 3, entryAgeDays: 3, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).not.toMatch(/days ago|since this page was last shaped|today/i)
  })

  it('an 8-day gap crosses the recency floor → day wording appears', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 8, entryAgeDays: 8, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).toMatch(/8 days ago|eight days ago/i)
    expect(prompt).not.toMatch(/today/i)
  })

  it('20-day gap uses day wording (below the ~3-week boundary)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 20, entryAgeDays: 20, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).toMatch(/20 days ago|twenty days ago/i)
    expect(prompt).not.toMatch(/today/i)
  })

  it('21-day gap uses rounded-~3-week wording at the boundary (not day wording)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 21, entryAgeDays: 21, isHistoricalEntry: false, isFutureEntry: false },
    })
    // boundary: >=3 weeks → switch from day wording to "~3 weeks"
    expect(prompt).toMatch(/(about|roughly) 3 weeks/i)
    expect(prompt).not.toMatch(/21 days ago/i)
  })

  it('22-day gap still uses rounded-~3-week wording (boundary inclusive)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 22, entryAgeDays: 22, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).toMatch(/(about|roughly) 3 weeks/i)
    expect(prompt).not.toMatch(/22 days ago/i)
  })

  it('A 45-day-old entry is "about 6 weeks" ago, NOT "today"', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 45, entryAgeDays: 45, isHistoricalEntry: false, isFutureEntry: false },
    })
    expect(prompt).toMatch(/(about|roughly) 6 weeks/i)
    expect(prompt).not.toMatch(/today/i)
  })

  it('a 1-day gap stays silent (no recency framing for daily journaling)', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: 1, entryAgeDays: 1, isHistoricalEntry: false, isFutureEntry: false },
    })
    // 1 day is well below anything meaningful — there must be no "X weeks" /
    // "X days ago" / evolution framing.
    expect(prompt).not.toMatch(/days ago|since this page was last shaped|becoming (rarer|lighter)/i)
    expect(prompt).not.toMatch(/today/i)
  })

  it('a future timestamp uses generic "this reflection" wording with NO evolution/timeline claim', () => {
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: { gapDays: null, entryAgeDays: null, isHistoricalEntry: false, isFutureEntry: true },
    })
    expect(prompt).toMatch(/this reflection/i)
    // Future/invalid timing MUST NOT fabricate a temporal-evolution storyline
    // (no "changed over time", no "X weeks since last shaped", no "today").
    expect(prompt).not.toMatch(/since this page was last shaped/i)
    expect(prompt).not.toMatch(/changed over .* time/i)
    expect(prompt).not.toMatch(/today/i)
  })

  it('a historical entry (predates the page) is framed as past evidence, not as the theme changing after now', () => {
    // gapDays is null here because the entry predates the current page — the
    // engine computes isHistoricalEntry=true and suppresses the evolution framing.
    const prompt = buildUpdatePagePrompt({
      ...withContent,
      timing: {
        gapDays: null,
        entryAgeDays: 60, // historically imported entry, 60 days old
        isHistoricalEntry: true,
        isFutureEntry: false,
      },
    })
    // The model must NOT claim the theme "changed" relative to the current page
    // (the entry is older evidence — the synthesis just folds it in).
    expect(prompt).not.toMatch(/since this page was last shaped/i)
    expect(prompt).not.toMatch(/how this theme has changed over/i)
    // And no fabricated temporal-fiction claim
    expect(prompt).not.toMatch(/today/i)
  })
})

describe('F-4 computeTiming (engine) — deterministic, calendar-day', () => {
  // Cross-check that the engine's TimingContext computation matches the
  // semantics the prompt tests above rely on. Pure function — pass explicit
  // `now`, so the suite is wall-clock-independent (F-4 spec).
  const DAY = 24 * 60 * 60 * 1000
  // Anchor "now" at local midnight-equivalent; calendar-day arithmetic should
  // be robust to wall-time crossing midnight. We use a fixed ISO date for stability.
  const NOW_LOCAL = Date.UTC(2024, 1, 15, 12, 0, 0) // Fri 2024-02-15 12:00 UTC
  it('a same-day entry yields entryAgeDays === 0 ("today")', () => {
    const sameDay = Date.UTC(2024, 1, 15, 0, 30) // very early on the 15th
    const t = computeTiming({ pageUpdatedAt: NOW_LOCAL - 4 * DAY, entryCreatedAt: sameDay, now: NOW_LOCAL })
    expect(t.entryAgeDays).toBe(0)
    expect(t.isFutureEntry).toBe(false)
    expect(t.isHistoricalEntry).toBe(false)
    expect(t.gapDays).toBe(4) // page shaped 4 days BEFORE today
  })

  it('an entry just before midnight is 1 day old, not 0 (calendar bucket)', () => {
    // 23:59 on Feb 14, now=00:01 on Feb 15 → calendar-day 1, not 0
    const crossMidnight = Date.UTC(2024, 1, 14, 23, 59)
    const justAfterMidnight = Date.UTC(2024, 1, 15, 0, 1)
    const t = computeTiming({ pageUpdatedAt: 0, entryCreatedAt: crossMidnight, now: justAfterMidnight })
    expect(t.entryAgeDays).toBe(1)
  })

  it('a future entry is flagged; entryAgeDays + gapDays are null', () => {
    const t = computeTiming({
      pageUpdatedAt: NOW_LOCAL - DAY,
      entryCreatedAt: NOW_LOCAL + DAY, // one day in the future
      now: NOW_LOCAL,
    })
    expect(t.isFutureEntry).toBe(true)
    expect(t.entryAgeDays).toBeNull()
    expect(t.gapDays).toBeNull()
    expect(t.isHistoricalEntry).toBe(false)
  })

  it('an entry predating the page latest update is historical — gapDays is null, isHistoricalEntry true', () => {
    const t = computeTiming({
      pageUpdatedAt: NOW_LOCAL - DAY, // page shaped YESTERDAY
      entryCreatedAt: NOW_LOCAL - 10 * DAY, // entry is 10 days OLDER than the page
      now: NOW_LOCAL,
    })
    expect(t.isHistoricalEntry).toBe(true)
    expect(t.gapDays).toBeNull() // don't emit negative / evolution wording
    expect(t.entryAgeDays).toBe(10) // 10 days ago (calendar buckets)
    expect(t.isFutureEntry).toBe(false)
  })

  it('a page with no prior content has gapDays null (first synthesis — no "page been quiet" framing)', () => {
    const t = computeTiming({
      pageUpdatedAt: null,
      entryCreatedAt: NOW_LOCAL,
      now: NOW_LOCAL,
    })
    expect(t.gapDays).toBeNull()
    expect(t.entryAgeDays).toBe(0)
  })

  it('21-day and 22-day gaps cross the ~3-week boundary identically (no off-by-one between consecutive days)', () => {
    const t21 = computeTiming({
      pageUpdatedAt: NOW_LOCAL - 21 * DAY,
      entryCreatedAt: NOW_LOCAL,
      now: NOW_LOCAL,
    })
    const t22 = computeTiming({
      pageUpdatedAt: NOW_LOCAL - 22 * DAY,
      entryCreatedAt: NOW_LOCAL,
      now: NOW_LOCAL,
    })
    // boundary: 21d and 22d are both "about 3 weeks". The ONLY transition is
    // below 21 → "days". So gapDays is a plain integer; the prompt decides the
    // threshold. Critical: 21d→3 weeks (not 2 weeks), 22d→3 weeks (not 3.1).
    expect(t21.gapDays).toBe(21)
    expect(t22.gapDays).toBe(22)
  })
})
