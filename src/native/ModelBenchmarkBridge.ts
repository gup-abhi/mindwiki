import { initLlama, type LlamaContext } from 'llama.rn'

import {
  BENCHMARK_MODELS,
  benchmarkModelPath,
  type BenchmarkModelId,
} from '@/services/llm/dev/benchmark-models'

export interface BenchmarkCompletionOptions {
  maxTokens: number
  temperature: number
}

export type BenchmarkChatRole = 'system' | 'user' | 'assistant'

export interface BenchmarkChatMessage {
  role: BenchmarkChatRole
  content: string
}

export type BenchmarkPrompt =
  | { kind: 'single_turn'; content: string }
  | { kind: 'conversation'; messages: BenchmarkChatMessage[] }

export interface BenchmarkLoadResult {
  loadMs: number
  cold: boolean
}

export interface BenchmarkCompletionResult {
  text: string
  durationMs: number
  tokensPredicted: number
  tokensPerSec: number
}

const IDLE_TIMEOUT_MS = 60_000

let context: LlamaContext | null = null
let loadedModel: BenchmarkModelId | null = null
let lock: Promise<void> = Promise.resolve()

function withBenchmarkLock<T>(fn: () => Promise<T>): Promise<T> {
  const current = lock.then(fn, fn)
  lock = current.then(() => undefined, () => undefined)
  return current
}

function buildQwen2_5ChatML(prompt: string): string {
  return (
    '<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n' +
    `<|im_start|>user\n${prompt}<|im_end|>\n` +
    '<|im_start|>assistant\n'
  )
}

// Qwen3-4B-Instruct-2507 GGUF uses the same ChatML delimiter family as the
// current Qwen2.5 artifact. Keep this builder separate so candidate-template
// validation never changes the production prompt path.
function buildQwen3ChatML(prompt: string): string {
  return buildQwen2_5ChatML(prompt)
}

function buildConversationChatML(messages: BenchmarkChatMessage[]): string {
  return messages
    .map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>\n`)
    .join('') + '<|im_start|>assistant\n'
}

function benchmarkPrompt(id: BenchmarkModelId, prompt: BenchmarkPrompt): string {
  if (prompt.kind === 'conversation') return buildConversationChatML(prompt.messages)
  return BENCHMARK_MODELS[id].template === 'qwen3_chatml'
    ? buildQwen3ChatML(prompt.content)
    : buildQwen2_5ChatML(prompt.content)
}

async function releaseLoadedContext(): Promise<void> {
  const active = context
  context = null
  loadedModel = null
  if (!active) return
  try {
    await active.release()
  } catch {
    // Release is best-effort. Clearing local ownership prevents a failed native
    // cleanup from retaining an unsafe stale benchmark context in JS.
  }
}

async function load(id: BenchmarkModelId): Promise<BenchmarkLoadResult> {
  if (context && loadedModel === id) return { loadMs: 0, cold: false }
  if (context) await releaseLoadedContext()

  const startedAt = performance.now()
  try {
    // Keep this object separate from the call expression. llama.rn 0.12.4's
    // ContextParams declaration omits n_threads_batch even though its native
    // bridge accepts it (and production LLMBridge uses the same setting).
    const params = {
      model: benchmarkModelPath(id),
      n_ctx: 2048,
      n_threads: 6,
      n_threads_batch: 6,
    }
    context = await initLlama(params)
    loadedModel = id
    return { loadMs: performance.now() - startedAt, cold: true }
  } catch {
    context = null
    loadedModel = null
    throw new Error('BENCHMARK_MODEL_LOAD_FAILED')
  }
}

async function complete(
  id: BenchmarkModelId,
  prompt: BenchmarkPrompt,
  options: BenchmarkCompletionOptions
): Promise<BenchmarkCompletionResult> {
  const active = context
  if (!active || loadedModel !== id) throw new Error('BENCHMARK_MODEL_NOT_LOADED')

  const startedAt = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastActivity = Date.now()
  const completion = active.completion(
    {
      prompt: benchmarkPrompt(id, prompt),
      n_predict: options.maxTokens,
      temperature: options.temperature,
      stop: ['<|im_end|>', '<|endoftext|>'],
    },
    () => {
      lastActivity = Date.now()
    }
  )
  const stalled = new Promise<never>((_, reject) => {
    const tick = () => {
      const idleMs = Date.now() - lastActivity
      if (idleMs >= IDLE_TIMEOUT_MS) {
        try {
          void Promise.resolve(active.stopCompletion()).catch(() => undefined)
        } catch {
          // Stopping is best-effort; the rejection clears the benchmark lock.
        }
        reject(new Error('BENCHMARK_MODEL_STALLED'))
        return
      }
      timer = setTimeout(tick, IDLE_TIMEOUT_MS - idleMs)
    }
    timer = setTimeout(tick, IDLE_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([completion, stalled])
    return {
      text: result.text,
      durationMs: performance.now() - startedAt,
      tokensPredicted: result.tokens_predicted,
      tokensPerSec: result.timings.predicted_per_second,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'BENCHMARK_MODEL_STALLED') throw error
    throw new Error('BENCHMARK_COMPLETION_FAILED')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const ModelBenchmarkBridge = {
  loadModel(id: BenchmarkModelId): Promise<BenchmarkLoadResult> {
    return withBenchmarkLock(() => load(id))
  },

  complete(
    id: BenchmarkModelId,
    prompt: BenchmarkPrompt,
    options: BenchmarkCompletionOptions
  ): Promise<BenchmarkCompletionResult> {
    return withBenchmarkLock(() => complete(id, prompt, options))
  },

  releaseModel(): Promise<void> {
    return withBenchmarkLock(releaseLoadedContext)
  },
}

export const __benchmarkTemplateForTest = benchmarkPrompt
