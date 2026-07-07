/**
 * Wiki-synthesis eval harness.
 *
 * The wiki IS the product, and the deep model that writes it is about to be
 * swapped (Qwen2.5 3B → Qwen3-4B). A new model brings new prose quirks and new
 * ways to leak prompt scaffolding, and a silent synthesis regression is the
 * worst failure mode we have. This file is the regression net:
 *
 *  - `checkHouseStyle` is the executable definition of a "good" wiki page — the
 *    same contract the synthesis prompt asks for (second person, flowing prose,
 *    no headings, no section labels). It's model-independent, so a future
 *    on-device eval can score REAL model output with the exact same checker.
 *  - The fixture table drives realistic model outputs through the real
 *    `synthesizePage` / `synthesizePageReGround` pipelines (only the LLM call
 *    is mocked) and asserts the structured outcome — kept / stripped-then-kept /
 *    rejected — and that every page that survives meets the house style.
 *
 * To extend: add a fixture. When the new model leaks in a new way, add a raw
 * sample here and (if needed) a strip pattern in deep-model's SCAFFOLDING_LINE.
 */
import { synthesizePage, synthesizePageReGround } from '@/services/llm/deep-model'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({
  LLMBridge: { synthesise: jest.fn(), converse: jest.fn() },
}))
const mockSynthesise = LLMBridge.synthesise as jest.Mock

const input = {
  title: 'Anxiety',
  category: 'emotion',
  existingContent: '',
  situation: 'a meeting',
  thought: 'I will fail',
}

const pastEntries = [
  { situation: 'Missed a deadline', thought: 'I am unreliable', created_at: 1710000000000 },
  { situation: 'Team retro went badly', thought: 'Everyone thinks I underperform', created_at: 1710100000000 },
]

/**
 * Returns the ways `content` breaks the wiki house style — empty array means a
 * clean page. Deterministic and prose-shape only, so it works on any model's
 * output. Mirrors what `buildUpdatePagePrompt`'s PAGE_STYLE asks for.
 */
function checkHouseStyle(content: string): string[] {
  const violations: string[] = []
  const lines = content.split('\n').map((l) => l.trim())

  // The page is about the reader ("you"); the narrator never speaks as "I".
  if (/\bI\b|\bI['’](m|ve|ll|d)\b|\bmy\b|\bmine\b/.test(content)) {
    violations.push('first-person voice')
  }
  // Flowing prose — never markdown "#" headings.
  if (lines.some((l) => /^#{1,6}\s/.test(l))) {
    violations.push('markdown heading')
  }
  // No CBT-skeleton or prompt-scaffolding labels echoed as headings.
  const LABEL = /^(situation|thought|behaviou?r|current page|new reflection|reframe lens|thinking pattern|feeling):/i
  if (lines.some((l) => LABEL.test(l))) {
    violations.push('section label')
  }
  return violations
}

describe('checkHouseStyle (the eval contract)', () => {
  it('passes a clean, second-person prose page', () => {
    expect(checkHouseStyle('You tend to brace for the worst before a deadline.')).toEqual([])
  })

  it('flags first-person voice', () => {
    expect(checkHouseStyle('I always panic before meetings.')).toContain('first-person voice')
    expect(checkHouseStyle("It's my fault when things go wrong.")).toContain('first-person voice')
  })

  it('flags markdown headings', () => {
    expect(checkHouseStyle('## Anxiety\nYou notice it before meetings.')).toContain('markdown heading')
  })

  it('flags echoed section labels', () => {
    expect(checkHouseStyle('Situation: a meeting\nYou felt tense.')).toContain('section label')
    expect(checkHouseStyle('Thinking pattern: catastrophizing')).toContain('section label')
  })

  it('does not false-positive on words that merely contain a label or pronoun', () => {
    // "mine"/"I" patterns are word-bounded; "behaviour" mid-sentence isn't a label.
    expect(checkHouseStyle('Your determination shaped how you behaviourally cope.')).toEqual([])
    expect(checkHouseStyle('You undermine yourself when tired.')).toEqual([])
  })
})

interface Fixture {
  name: string
  /** Simulated raw deep-model output for this synthesis. */
  raw: string
  /** Does the pipeline keep the page (after stripping) or reject it? */
  outcome: 'kept' | 'rejected'
  /** Exact post-processed content, when the transform is deterministic. */
  expectContent?: string
}

const fixtures: Fixture[] = [
  {
    name: 'clean single-paragraph prose passes through untouched',
    raw: 'You tend to expect the worst before a deadline, then feel relief when it passes.',
    outcome: 'kept',
    expectContent: 'You tend to expect the worst before a deadline, then feel relief when it passes.',
  },
  {
    name: 'clean multi-paragraph prose is kept',
    raw:
      'You brace for the worst before big meetings.\n\n' +
      'Afterwards you often notice it went better than you feared.',
    outcome: 'kept',
  },
  {
    name: 'surrounding whitespace is trimmed',
    raw: '   You notice it before meetings.   ',
    outcome: 'kept',
    expectContent: 'You notice it before meetings.',
  },
  {
    name: 'leaked scaffolding lines are stripped, real prose survives clean',
    raw:
      'For your understanding only — do NOT define these terms:\n' +
      'Thinking pattern: All-or-nothing thinking — seeing extremes.\n' +
      'Reframe lens: where is the middle ground?\n' +
      'Current page:\n' +
      'You tend to see your work as either a total success or a total failure.',
    outcome: 'kept',
    expectContent: 'You tend to see your work as either a total success or a total failure.',
  },
  {
    name: 'echoed CBT skeleton labels are stripped, leaving the synthesis',
    raw:
      'Situation: a tense review meeting\n' +
      'Thought: I will be exposed as a fraud\n' +
      'You carry a fear of being found out, even when your work holds up.',
    outcome: 'kept',
    expectContent: 'You carry a fear of being found out, even when your work holds up.',
  },
  {
    name: 'output that is nothing but scaffolding is rejected',
    raw: 'Current page:\nNew reflection:',
    outcome: 'rejected',
  },
  {
    name: 'whitespace-only output is rejected',
    raw: '   \n  \n ',
    outcome: 'rejected',
  },
  {
    name: 'over-length output (>4000 chars) is rejected',
    raw: 'You feel anxious. '.repeat(250), // ~4500 chars
    outcome: 'rejected',
  },
]

describe('synthesizePage eval fixtures', () => {
  beforeEach(() => mockSynthesise.mockReset())

  fixtures.forEach((f) => {
    it(f.name, async () => {
      mockSynthesise.mockResolvedValue({ text: f.raw })
      const result = await synthesizePage(input)

      if (f.outcome === 'rejected') {
        expect(result.success).toBe(false)
        if (!result.success) expect(result.error.code).toBe('SYNTH_VALIDATION_FAILED')
        return
      }

      expect(result.success).toBe(true)
      if (!result.success) return
      if (f.expectContent !== undefined) {
        expect(result.data).toBe(f.expectContent)
      }
      // Every page that reaches the wiki must meet the house style.
      expect(checkHouseStyle(result.data)).toEqual([])
    })
  })
})

interface ReGroundFixture {
  name: string
  raw: string
  outcome: 'kept' | 'rejected'
  expectContent?: string
}

const reGroundInput = {
  ...input,
  existingContent: 'You tend to expect the worst before a deadline.',
  pastEntries,
}

const reGroundFixtures: ReGroundFixture[] = [
  {
    name: 're-ground: clean multi-paragraph prose passes through',
    raw: 'You feel dread before big meetings, even though they usually go fine. Lately this has eased as you notice your preparation pays off.',
    outcome: 'kept',
  },
  {
    name: 're-ground: "Current page:" and "Past entries:" label lines are stripped',
    raw:
      'Current page:\n' +
      'You tend to expect the worst before a deadline.\n' +
      'Past entries:\n' +
      'Missed a deadline — you felt unreliable.\n' +
      'This pattern shows up most around work.',
    outcome: 'kept',
    // The scaffolding labels are stripped, leaving the prose lines between them
    expectContent: 'You tend to expect the worst before a deadline.\nMissed a deadline — you felt unreliable.\nThis pattern shows up most around work.',
  },
  {
    name: 're-ground: output that is only scaffolding is rejected',
    raw: 'Current page:\nNew entry:\nPast entries:',
    outcome: 'rejected',
  },
  {
    name: 're-ground: "Past entries:" label stripped, real prose survives',
    raw:
      'Past entries:\n' +
      'You tend to brace for the worst.\n' +
      'You notice that missed deadlines feel catastrophic even when the fallout is minor.',
    outcome: 'kept',
    // Only the "Past entries:" line is removed; the content line and prose remain
    expectContent: 'You tend to brace for the worst.\nYou notice that missed deadlines feel catastrophic even when the fallout is minor.',
  },
]

describe('synthesizePageReGround eval fixtures', () => {
  beforeEach(() => mockSynthesise.mockReset())

  reGroundFixtures.forEach((f) => {
    it(f.name, async () => {
      mockSynthesise.mockResolvedValue({ text: f.raw })
      const result = await synthesizePageReGround(reGroundInput)

      if (f.outcome === 'rejected') {
        expect(result.success).toBe(false)
        if (!result.success) expect(result.error.code).toBe('REGROUND_VALIDATION_FAILED')
        return
      }

      expect(result.success).toBe(true)
      if (!result.success) return
      if (f.expectContent !== undefined) {
        expect(result.data).toBe(f.expectContent)
      }
      expect(checkHouseStyle(result.data)).toEqual([])
    })
  })
})
