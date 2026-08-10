import { ModelBenchmarkBridge } from '@/native/ModelBenchmarkBridge'
import { type EntryExtract, EntryExtractSchema } from '@/services/llm/schemas/entry-extract.schema'
import { canonicalizeEmotion, canonicalizeDistortion, canonicalizeLabel, normalizeBeliefs, normalizeEntities, normalizePhrases, singularizeLabel } from '@/services/llm/taxonomy'

import { type BenchmarkModelId } from './benchmark-models'
import {
  EXTRACTION_BENCHMARK_FIXTURES,
  extractionPrompt,
  REFLECT_BENCHMARK_FIXTURES,
  WIKI_SYNTHESIS_BENCHMARK_FIXTURES,
} from './model-benchmark-fixtures'
import { checkReflectReply, checkWikiHouseStyle } from './model-benchmark-checks'

export interface BenchmarkRunOptions {
  soakRuns?: number
}

export interface ModelBenchmarkReport {
  modelId: BenchmarkModelId
  loadMs: number
  completed: number
  failures: number
  extractionValid: number
  extractionExact: number
  wikiStylePasses: number
  reflectStylePasses: number
  thinkLeakCount: number
  durationsMs: number[]
  tokensPerSec: number[]
  p50Ms: number
  p95Ms: number
  worstMs: number
  meanTokensPerSec: number
  released: boolean
}

function extractSingleJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function normalizeExtract(extract: EntryExtract): EntryExtract {
  const distortion = extract.distortion_confidence >= 0.6
    ? canonicalizeDistortion(extract.distortion)
    : 'none'
  return {
    ...extract,
    emotion: canonicalizeEmotion(extract.emotion),
    distortion,
    topics: extract.topics
      .filter((topic) => topic.trim().toLowerCase() !== 'none')
      .map((topic) => singularizeLabel(canonicalizeLabel(topic))),
    people: normalizeEntities(extract.people),
    places: normalizeEntities(extract.places),
    activities: normalizeEntities(extract.activities),
    beliefs: normalizeBeliefs(extract.beliefs),
    behaviors: normalizePhrases(extract.behaviors),
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isExactExtract(extract: EntryExtract, expected: typeof EXTRACTION_BENCHMARK_FIXTURES[number]['expected']): boolean {
  return extract.emotion === expected.emotion &&
    extract.distortion === expected.distortion &&
    extract.is_self_relevant === expected.isSelfRelevant &&
    sameStrings(extract.topics, expected.topics) &&
    sameStrings(extract.people, expected.people) &&
    sameStrings(extract.places, expected.places) &&
    sameStrings(extract.activities, expected.activities) &&
    sameStrings(extract.beliefs, expected.beliefs) &&
    sameStrings(extract.behaviors, expected.behaviors)
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function emptyReport(modelId: BenchmarkModelId, loadMs: number): ModelBenchmarkReport {
  return {
    modelId,
    loadMs,
    completed: 0,
    failures: 0,
    extractionValid: 0,
    extractionExact: 0,
    wikiStylePasses: 0,
    reflectStylePasses: 0,
    thinkLeakCount: 0,
    durationsMs: [],
    tokensPerSec: [],
    p50Ms: 0,
    p95Ms: 0,
    worstMs: 0,
    meanTokensPerSec: 0,
    released: false,
  }
}

function recordCompletion(report: ModelBenchmarkReport, result: { text: string; durationMs: number; tokensPerSec: number }): void {
  report.completed++
  report.durationsMs.push(result.durationMs)
  report.tokensPerSec.push(result.tokensPerSec)
  if (/<think\b/i.test(result.text)) report.thinkLeakCount++
}

function finalize(report: ModelBenchmarkReport): ModelBenchmarkReport {
  return {
    ...report,
    p50Ms: percentile(report.durationsMs, 0.5),
    p95Ms: percentile(report.durationsMs, 0.95),
    worstMs: report.durationsMs.length === 0 ? 0 : Math.max(...report.durationsMs),
    meanTokensPerSec: mean(report.tokensPerSec),
  }
}

/**
 * Runs only synthetic, in-memory jobs against a benchmark-owned native context.
 * It intentionally does not call production extraction, pipeline, storage, wiki,
 * graph, retrieval, sync, or Reflect services.
 */
export async function runModelBenchmark(
  modelId: BenchmarkModelId,
  options: BenchmarkRunOptions = {}
): Promise<ModelBenchmarkReport> {
  const load = await ModelBenchmarkBridge.loadModel(modelId)
  const report = emptyReport(modelId, load.loadMs)

  try {
    for (const fixture of EXTRACTION_BENCHMARK_FIXTURES) {
      try {
        const result = await ModelBenchmarkBridge.complete(modelId, extractionPrompt(fixture), {
          maxTokens: 200,
          temperature: 0,
        })
        recordCompletion(report, result)
        const json = extractSingleJson(result.text)
        const parsed = EntryExtractSchema.safeParse(json)
        if (parsed.success) {
          report.extractionValid++
          if (isExactExtract(normalizeExtract(parsed.data), fixture.expected)) report.extractionExact++
        }
      } catch {
        report.failures++
      }
    }

    for (const fixture of WIKI_SYNTHESIS_BENCHMARK_FIXTURES) {
      try {
        const result = await ModelBenchmarkBridge.complete(modelId, fixture.prompt, {
          maxTokens: 400,
          temperature: 0.5,
        })
        recordCompletion(report, result)
        if (result.text.trim().length > 0 && checkWikiHouseStyle(result.text).length === 0) {
          report.wikiStylePasses++
        }
      } catch {
        report.failures++
      }
    }

    for (const fixture of REFLECT_BENCHMARK_FIXTURES) {
      try {
        const result = await ModelBenchmarkBridge.complete(modelId, fixture.prompt, {
          maxTokens: 110,
          temperature: 0.4,
        })
        recordCompletion(report, result)
        if (checkReflectReply(result.text).length === 0) report.reflectStylePasses++
      } catch {
        report.failures++
      }
    }

    const soakRuns = options.soakRuns ?? 0
    const soakFixture = WIKI_SYNTHESIS_BENCHMARK_FIXTURES[0]
    for (let index = 0; index < soakRuns; index++) {
      try {
        const result = await ModelBenchmarkBridge.complete(modelId, soakFixture.prompt, {
          maxTokens: 160,
          temperature: 0.5,
        })
        recordCompletion(report, result)
      } catch {
        report.failures++
      }
    }
  } finally {
    await ModelBenchmarkBridge.releaseModel()
    report.released = true
  }

  return finalize(report)
}
