import { initLlama, type LlamaContext } from 'llama.rn'

import { modelLoadPath } from '@/services/llm/model-manager'

export type ModelKind = 'fast' | 'deep'

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
}

const contexts: Partial<Record<ModelKind, LlamaContext>> = {}

async function ensureLoaded(kind: ModelKind): Promise<LlamaContext> {
  const existing = contexts[kind]
  if (existing) return existing
  const model = modelLoadPath(kind)
  try {
    const ctx = await initLlama({ model, n_ctx: 2048 })
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

async function run(
  kind: ModelKind,
  prompt: string,
  opts: InferenceOptions
): Promise<InferenceResult> {
  const ctx = await ensureLoaded(kind)
  let result
  try {
    result = await ctx.completion({
      prompt: buildChatML(prompt),
      n_predict: opts.maxTokens,
      temperature: opts.temperature,
      stop: ['<|im_end|>', '<|endoftext|>'],
    })
  } catch (e) {
    throw new Error(`Completion failed for ${kind} model: ${String(e)}`)
  }
  return {
    text: result.text,
    tokensPredicted: result.tokens_predicted,
    tokensPerSec: result.timings.predicted_per_second,
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
}
