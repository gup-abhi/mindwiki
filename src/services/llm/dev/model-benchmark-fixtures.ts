import { buildConversationMessages } from '@/services/llm/prompts/conversation'
import { buildExtractPrompt, type ExtractPromptInput } from '@/services/llm/prompts/extract-entry'
import { buildUpdatePagePrompt, type UpdatePageInput } from '@/services/llm/prompts/update-page'
import { type BenchmarkPrompt } from '@/native/ModelBenchmarkBridge'

export interface ExtractionBenchmarkFixture {
  id: string
  input: ExtractPromptInput
  expected: {
    emotion: string
    distortion: string
    topics: string[]
    people: string[]
    places: string[]
    activities: string[]
    beliefs: string[]
    behaviors: string[]
    isSelfRelevant: boolean
  }
}

export interface TextBenchmarkFixture {
  id: string
  prompt: BenchmarkPrompt
}

export const EXTRACTION_BENCHMARK_FIXTURES: readonly ExtractionBenchmarkFixture[] = [
  {
    id: 'work-anxiety',
    input: { situation: 'I have a review meeting with my manager tomorrow', thought: 'I will be exposed as incompetent' },
    expected: {
      emotion: 'Anxiety',
      distortion: 'Catastrophizing',
      topics: ['Work'],
      people: ['Manager'],
      places: [],
      activities: ['Review meeting'],
      beliefs: ['I am incompetent'],
      behaviors: [],
      isSelfRelevant: true,
    },
  },
  {
    id: 'app-achievement',
    input: { situation: 'I finished the first version of my app today', thought: 'I can learn difficult things when I stay with them' },
    expected: {
      emotion: 'Joy',
      distortion: 'none',
      topics: ['App'],
      people: [],
      places: [],
      activities: ['App'],
      beliefs: ['I can learn difficult things'],
      behaviors: ['Persistence'],
      isSelfRelevant: true,
    },
  },
  {
    id: 'relationship-avoidance',
    input: { situation: 'Sarah did not reply to my message all evening', thought: 'She is tired of me', behavior: 'I kept checking my phone instead of doing anything else' },
    expected: {
      emotion: 'Anxiety',
      distortion: 'Mind reading',
      topics: ['Relationship'],
      people: ['Sarah'],
      places: [],
      activities: [],
      beliefs: ['People will leave me'],
      behaviors: ['Checking'],
      isSelfRelevant: true,
    },
  },
] as const

export const WIKI_SYNTHESIS_BENCHMARK_FIXTURES: readonly TextBenchmarkFixture[] = [
  {
    id: 'work-anxiety-page',
    prompt: {
      kind: 'single_turn',
      content: buildUpdatePagePrompt({
        title: 'Work anxiety',
        category: 'emotion',
        existingContent: '',
        situation: 'A review meeting is coming up tomorrow.',
        thought: 'I will be exposed as incompetent.',
        distortion: 'Catastrophizing',
      } satisfies UpdatePageInput),
    },
  },
  {
    id: 'relationship-page',
    prompt: {
      kind: 'single_turn',
      content: buildUpdatePagePrompt({
        title: 'Relationship',
        category: 'theme',
        existingContent: 'You tend to look for signs that a pause means someone is pulling away.',
        situation: 'Sarah did not reply all evening.',
        thought: 'She is tired of me.',
        behavior: 'I kept checking my phone.',
      } satisfies UpdatePageInput),
    },
  },
] as const

export const REFLECT_BENCHMARK_FIXTURES: readonly TextBenchmarkFixture[] = [
  {
    id: 'meeting-reflection',
    prompt: {
      kind: 'conversation',
      messages: buildConversationMessages({
        history: [],
        message: 'I cannot stop replaying tomorrow’s review meeting in my head.',
        context: {
          sources: [],
          connections: [],
        },
      }),
    },
  },
  {
    id: 'loneliness-reflection',
    prompt: {
      kind: 'conversation',
      messages: buildConversationMessages({
        history: [{ role: 'assistant', content: 'That silence sounds hard to sit with.' }],
        message: 'It still feels like nobody really wants me around.',
        context: {
          sources: [],
          connections: [],
        },
      }),
    },
  },
] as const

export function extractionPrompt(fixture: ExtractionBenchmarkFixture): BenchmarkPrompt {
  return { kind: 'single_turn', content: buildExtractPrompt(fixture.input) }
}
