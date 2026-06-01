import { notImplemented } from './notImplemented'

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
 * On-device GGUF inference. Phase -1 validated llama.rn/GGUF on device
 * (Qwen2.5 1.5B ~45 tok/s, 3B ~18 tok/s). Raw entry text is NEVER sent to a
 * network — inference is on-device only. Native wiring lands in Phase 2.
 */
export interface ILLMBridge {
  loadModel(kind: ModelKind): Promise<void>
  /** Fast model — structured JSON tags (≤2s target). */
  tag(prompt: string, opts: InferenceOptions): Promise<InferenceResult>
  /** Deep model — prose synthesis (background). */
  synthesise(prompt: string, opts: InferenceOptions): Promise<InferenceResult>
}

export const LLMBridge: ILLMBridge = {
  async loadModel() {
    return notImplemented('LLMBridge.loadModel')
  },
  async tag() {
    return notImplemented('LLMBridge.tag')
  },
  async synthesise() {
    return notImplemented('LLMBridge.synthesise')
  },
}
