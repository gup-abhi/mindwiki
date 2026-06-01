// Real on-device GGUF inference via llama.rn (llama.cpp). Replaces LLMBridgeStub.
//
// Models are NOT bundled (too large). Push them to the app's external files dir:
//   adb push models/fast-model.gguf /storage/emulated/0/Android/data/com.mindwiki.demo/files/
//   adb push models/deep-model.gguf /storage/emulated/0/Android/data/com.mindwiki.demo/files/
// (Android-only paths — this demo runs on Android.)

import { initLlama, type LlamaContext } from 'llama.rn'

const MODELS_DIR = '/storage/emulated/0/Android/data/com.mindwiki.demo/files'
const MODEL_PATHS = {
  fast: `${MODELS_DIR}/fast-model.gguf`,
  deep: `${MODELS_DIR}/deep-model.gguf`,
} as const

type ModelKind = keyof typeof MODEL_PATHS

export interface InferenceOptions {
  maxTokens: number
  temperature: number
}

export interface InferenceResult {
  text: string
  tokensPredicted: number
  tokensPerSec: number
}

const contexts: Partial<Record<ModelKind, LlamaContext>> = {}

async function ensureLoaded(kind: ModelKind): Promise<LlamaContext> {
  const existing = contexts[kind]
  if (existing) return existing
  const model = MODEL_PATHS[kind]
  try {
    const ctx = await initLlama({ model, n_ctx: 2048 })
    contexts[kind] = ctx
    return ctx
  } catch (e) {
    throw new Error(`Failed to load ${kind} model at ${model} — did you adb push it? (${String(e)})`)
  }
}

// Qwen2.5 uses ChatML. Build the prompt directly to avoid depending on llama.rn's
// chat-template / jinja path (which is what was failing with a bare "unknown error").
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

export const LLMBridge = {
  async loadModel(kind: ModelKind): Promise<void> {
    await ensureLoaded(kind)
  },

  tag(prompt: string, opts: InferenceOptions): Promise<InferenceResult> {
    return run('fast', prompt, opts)
  },

  synthesise(prompt: string, opts: InferenceOptions): Promise<InferenceResult> {
    return run('deep', prompt, opts)
  },
}
