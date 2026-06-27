import { initLlama, getBackendDevicesInfo, type LlamaContext } from 'llama.rn'

import { modelLoadPath } from '@/services/llm/model-manager'

export type ModelKind = 'fast' | 'deep' | 'embed'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface InferenceOptions {
  maxTokens: number
  temperature: number
}

export interface InferenceResult {
  text: string
  tokensPredicted: number
  tokensPerSec: number
}

/**
 * On-device GGUF inference via llama.rn (validated in Phase -1: Qwen2.5 1.5B
 * ~45 tok/s, 3B ~18 tok/s). Raw entry text NEVER leaves the device.
 *
 * Models are not bundled — they're downloaded in-app into MODELS_DIR (see
 * services/llm/model-manager.ts), the same location this bridge loads from.
 */
export interface ILLMBridge {
  loadModel(kind: ModelKind): Promise<void>
  tag(prompt: string, opts: InferenceOptions): Promise<InferenceResult>
  synthesise(prompt: string, opts: InferenceOptions): Promise<InferenceResult>
  /**
   * Multi-turn completion on the deep model with optional per-token streaming.
   * `onToken` fires with each generated token's text as it arrives. Raw message
   * text NEVER leaves the device.
   */
  converse(
    messages: ChatMessage[],
    opts: InferenceOptions,
    onToken?: (token: string) => void
  ): Promise<InferenceResult>
  /**
   * Embed text into a semantic vector via the dedicated embedding model. Used to
   * rank wiki pages for Reflect by meaning, not just shared words. Text NEVER
   * leaves the device. Throws if the embedding model isn't downloaded — callers
   * must treat embeddings as best-effort and fall back to lexical ranking.
   */
  embed(text: string): Promise<number[]>
}

const contexts: Partial<Record<ModelKind, LlamaContext>> = {}

// One completion at a time per model context. llama.cpp can't run two
// completions on a single context concurrently, and we now fire overlapping
// deep-model work (a streamed reply, the rolling summary, and chat→wiki
// synthesis). Without this, the second concurrent call fails — which left blank
// wiki pages behind. Each kind has its own context, so they lock independently.
const locks: Partial<Record<ModelKind, Promise<unknown>>> = {}

function withModelLock<T>(kind: ModelKind, fn: () => Promise<T>): Promise<T> {
  const prev = locks[kind] ?? Promise.resolve()
  const next = prev.then(fn, fn) // run regardless of how the previous call settled
  locks[kind] = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

async function ensureLoaded(kind: ModelKind): Promise<LlamaContext> {
  const existing = contexts[kind]
  if (existing) return existing
  const model = modelLoadPath(kind)
  try {
    // The embedding model loads in embedding mode (mean-pooled, L2-normalized so
    // cosine == dot product) — a context opened this way serves ctx.embedding(),
    // not completions. A small window is plenty for one page/query.
    const params =
      kind === 'embed'
        ? { model, embedding: true, pooling_type: 'mean' as const, embd_normalize: 2, n_ctx: 512 }
        : { model, n_ctx: 2048 }
    const ctx = await initLlama(params)
    contexts[kind] = ctx
    void logBackendInfo(kind, ctx) // diagnostic only — see what this device offers
    return ctx
  } catch (e) {
    throw new Error(`Failed to load ${kind} model — download the AI models in the app first. (${String(e)})`)
  }
}

/**
 * Diagnostic probe (dev only): after a model loads, report whether it ran on an
 * accelerator and what backends this device actually exposes — the input to a
 * future per-device CPU/GPU/NPU selection. Logs hardware/capability only, never
 * any user content. Best-effort: a failure here never affects model loading.
 */
async function logBackendInfo(kind: ModelKind, ctx: LlamaContext): Promise<void> {
  if (!__DEV__) return
  try {
    console.log(`[llm-backend] ${kind}: gpu=${ctx.gpu} reasonNoGPU="${ctx.reasonNoGPU}"`)
    console.log(`[llm-backend] ${kind}: selectedDevices=${JSON.stringify(ctx.devices)}`)
    const backends = await getBackendDevicesInfo()
    const summary = backends
      .map((d) => `${d.backend}/${d.type}/${d.deviceName}(${Math.round(d.maxMemorySize / 1e6)}MB)`)
      .join(' | ')
    console.log(`[llm-backend] ${kind}: available=[${summary}]`)
  } catch (e) {
    console.log(`[llm-backend] ${kind}: backend info unavailable (${String(e)})`)
  }
}

// Qwen2.5 uses ChatML. Build the prompt directly to avoid llama.rn's chat-template
// path (which failed with a bare "unknown error" in Phase -1).
function buildChatML(prompt: string): string {
  return (
    '<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n' +
    `<|im_start|>user\n${prompt}<|im_end|>\n` +
    '<|im_start|>assistant\n'
  )
}

// Multi-turn ChatML: each message becomes its own <|im_start|>{role}…<|im_end|>
// block, ending with an open assistant turn for the model to complete.
function buildChatMLConversation(messages: ChatMessage[]): string {
  const turns = messages
    .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`)
    .join('')
  return turns + '<|im_start|>assistant\n'
}

async function run(
  kind: ModelKind,
  prompt: string,
  opts: InferenceOptions
): Promise<InferenceResult> {
  const ctx = await ensureLoaded(kind)
  let result
  try {
    result = await withModelLock(kind, () =>
      ctx.completion({
        prompt: buildChatML(prompt),
        n_predict: opts.maxTokens,
        temperature: opts.temperature,
        stop: ['<|im_end|>', '<|endoftext|>'],
      })
    )
  } catch (e) {
    throw new Error(`Completion failed for ${kind} model: ${String(e)}`)
  }
  return {
    text: result.text,
    tokensPredicted: result.tokens_predicted,
    tokensPerSec: result.timings.predicted_per_second,
  }
}

async function runConversation(
  messages: ChatMessage[],
  opts: InferenceOptions,
  onToken?: (token: string) => void
): Promise<InferenceResult> {
  const ctx = await ensureLoaded('deep')
  let result
  try {
    result = await withModelLock('deep', () =>
      ctx.completion(
        {
          prompt: buildChatMLConversation(messages),
          n_predict: opts.maxTokens,
          temperature: opts.temperature,
          stop: ['<|im_end|>', '<|endoftext|>'],
        },
        onToken ? (data) => onToken(data.token) : undefined
      )
    )
  } catch (e) {
    throw new Error(`Conversation completion failed for deep model: ${String(e)}`)
  }
  return {
    text: result.text,
    tokensPredicted: result.tokens_predicted,
    tokensPerSec: result.timings.predicted_per_second,
  }
}

async function runEmbed(text: string): Promise<number[]> {
  const ctx = await ensureLoaded('embed')
  try {
    const res = await withModelLock('embed', () => ctx.embedding(text))
    return res.embedding
  } catch (e) {
    throw new Error(`Embedding failed for embed model: ${String(e)}`)
  }
}

export const LLMBridge: ILLMBridge = {
  async loadModel(kind) {
    await ensureLoaded(kind)
  },
  tag(prompt, opts) {
    return run('fast', prompt, opts)
  },
  synthesise(prompt, opts) {
    return run('deep', prompt, opts)
  },
  converse(messages, opts, onToken) {
    return runConversation(messages, opts, onToken)
  },
  embed(text) {
    return runEmbed(text)
  },
}
