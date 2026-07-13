import { initLlama, type LlamaContext } from 'llama.rn'

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
// completions on a single context concurrently (and a second context would
// cost ~2GB RAM while splitting the same CPU cores — parallelism buys nothing
// on-device). Each kind has its own queue, so they lock independently.
//
// Two priorities per kind: 'high' (a live conversation reply the user is
// staring at) runs before any queued 'low' work (wiki synthesis, extracts,
// summaries). Each synthesis call is its own queue item, so a reply enqueued
// mid-backlog waits for at most ONE completion instead of the whole drain —
// a long capture backlog used to block starting a new conversation entirely.
interface LockItem {
  fn: () => Promise<unknown>
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}
const queues: Partial<Record<ModelKind, { running: boolean; high: LockItem[]; low: LockItem[] }>> = {}

function pumpLock(kind: ModelKind): void {
  const q = queues[kind]
  if (!q || q.running) return
  const item = q.high.shift() ?? q.low.shift()
  if (!item) return
  q.running = true
  Promise.resolve()
    .then(item.fn)
    .then(
      (v) => {
        q.running = false
        item.resolve(v)
        pumpLock(kind)
      },
      (e) => {
        q.running = false
        item.reject(e)
        pumpLock(kind)
      }
    )
}

function withModelLock<T>(
  kind: ModelKind,
  fn: () => Promise<T>,
  priority: 'high' | 'low' = 'low'
): Promise<T> {
  const q = (queues[kind] ??= { running: false, high: [], low: [] })
  return new Promise<T>((resolve, reject) => {
    q[priority].push({ fn, resolve: resolve as (v: unknown) => void, reject })
    pumpLock(kind)
  })
}

async function ensureLoaded(kind: ModelKind): Promise<LlamaContext> {
  const existing = contexts[kind]
  if (existing) return existing
  const model = modelLoadPath(kind)
  try {
    // The embedding model loads in embedding mode (mean-pooled, L2-normalized so
    // cosine == dot product) — a context opened this way serves ctx.embedding(),
    // not completions. A small window is plenty for one page/query.
    //
    // n_threads: llama.rn defaults to 4; this device (and modern phones) has 8
    // cores, so 6 threads for the completion models is a free speedup on both
    // prompt-eval and generation (device-measured ~1.3x chat, ~1.7x synthesis).
    // 6 (not 8) leaves headroom for the UI/OS thread.
    const params =
      kind === 'embed'
        ? { model, embedding: true, pooling_type: 'mean' as const, embd_normalize: 2, n_ctx: 512 }
        : { model, n_ctx: 2048, n_threads: 6, n_threads_batch: 6 }
    const ctx = await initLlama(params)
    contexts[kind] = ctx
    return ctx
  } catch (e) {
    throw new Error(`Failed to load ${kind} model — download the AI models in the app first. (${String(e)})`)
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

// If the deep model emits no token for this long, treat the reply as stalled:
// stop the completion and fail the turn so the UI can offer a retry. Idle-based
// (resets on every token), NOT a total cap — a slow but progressing reply is
// never cut off; only a wedged completion (which would otherwise hang the model
// lock forever) trips it. Generous enough to cover prompt eval before the first
// token on a slow device.
const CONVERSE_IDLE_TIMEOUT_MS = 60_000

async function runConversation(
  messages: ChatMessage[],
  opts: InferenceOptions,
  onToken?: (token: string) => void
): Promise<InferenceResult> {
  const ctx = await ensureLoaded('deep')
  let result
  try {
    // 'high': the user is watching this reply stream — background synthesis
    // waits its turn.
    result = await withModelLock('deep', async () => {
      let lastActivity = Date.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      // Always track token activity for the watchdog, forwarding to onToken when
      // the caller is streaming.
      const completion = ctx.completion(
        {
          prompt: buildChatMLConversation(messages),
          n_predict: opts.maxTokens,
          temperature: opts.temperature,
          stop: ['<|im_end|>', '<|endoftext|>'],
        },
        (data) => {
          lastActivity = Date.now()
          onToken?.(data.token)
        }
      )
      // Watchdog: re-arm against the last token; on a full idle window, stop the
      // native completion (releases the lock so a retry can run) and reject.
      const stalled = new Promise<never>((_, reject) => {
        const tick = () => {
          const idle = Date.now() - lastActivity
          if (idle >= CONVERSE_IDLE_TIMEOUT_MS) {
            // Best-effort stop; some llama.rn builds return undefined instead
            // of a promise, and a sync throw here would skip reject() — an
            // uncaught error in this timer wedges the model lock chain forever
            // (device: replies never came back until app restart).
            try {
              void Promise.resolve(ctx.stopCompletion()).catch(() => undefined)
            } catch {
              // stopping is best-effort; rejecting below is what matters
            }
            reject(new Error('deep model stalled — no tokens'))
          } else {
            timer = setTimeout(tick, CONVERSE_IDLE_TIMEOUT_MS - idle)
          }
        }
        timer = setTimeout(tick, CONVERSE_IDLE_TIMEOUT_MS)
      })
      try {
        return await Promise.race([completion, stalled])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }, 'high')
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
  // llama.rn's ctx.embedding() leaks state across calls and clearCache(true) is
  // a no-op for the leak on this build (device: cos(a1,a2)=0.655 cold→warm, the
  // binding appends to a shared KV with no n_past control). The only working
  // workaround is to throw the embed context away and load a fresh one per
  // call. Cost: ~1-2s load per embed — backfill over hundreds of pages is
  // bounded (sequential, best-effort), and a chat reply that needs an embed
  // blocks for the same ~1-2s.
  const ctx = await ensureLoaded('embed')
  try {
    const vec = await withModelLock('embed', async () => {
      const r = await ctx.embedding(text)
      return r.embedding
    })
    return vec
  } finally {
    // Drop the context so the NEXT embed starts clean. release() returns void
    // on success; never throw from finally — would mask the embed's own error.
    try {
      await ctx.release()
    } catch {
      // best-effort
    }
    delete contexts.embed
    // Also drop the embed queue's lock state — the previous run is over, no
    // pending items to keep.
    delete queues.embed
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
