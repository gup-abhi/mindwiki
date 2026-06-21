// Box breathing (4-4-4-4): inhale, hold, exhale, hold — equal four-second
// phases, repeated for a fixed number of cycles. Pure timing/geometry so the
// screen stays presentation-only. No model, no storage, no network.

export type BreathPhase = 'inhale' | 'hold-in' | 'exhale' | 'hold-out'

export interface PhaseStep {
  phase: BreathPhase
  seconds: number
  label: string
  /** Target scale for the breathing circle at the end of this phase. */
  scale: number
}

const SECONDS = 4
const MIN_SCALE = 0.55
const MAX_SCALE = 1

/** One full box-breathing cycle. */
export const BOX_CYCLE: readonly PhaseStep[] = [
  { phase: 'inhale', seconds: SECONDS, label: 'Breathe in', scale: MAX_SCALE },
  { phase: 'hold-in', seconds: SECONDS, label: 'Hold', scale: MAX_SCALE },
  { phase: 'exhale', seconds: SECONDS, label: 'Breathe out', scale: MIN_SCALE },
  { phase: 'hold-out', seconds: SECONDS, label: 'Hold', scale: MIN_SCALE },
]

/** The circle starts contracted, so the first inhale visibly grows it. */
export const START_SCALE = MIN_SCALE

export const CYCLES = 5
export const cycleSeconds = BOX_CYCLE.reduce((s, p) => s + p.seconds, 0)
export const totalSeconds = cycleSeconds * CYCLES
export const totalSteps = BOX_CYCLE.length * CYCLES

/** The step at a flat index across all cycles, with its 1-based cycle number. */
export function stepAt(index: number): { step: PhaseStep; cycle: number } {
  const step = BOX_CYCLE[index % BOX_CYCLE.length]
  const cycle = Math.floor(index / BOX_CYCLE.length) + 1
  return { step, cycle }
}
