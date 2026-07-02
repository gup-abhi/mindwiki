import { useCallback, useMemo, useState } from 'react'

import { getGuidedPath, type GuidedPath } from '@/lib/guided-paths'
import { deepenReflection } from '@/services/llm/deep-model'
import { capturePathAnswers } from '@/services/pipeline'
import { type CrisisAssessment } from '@/services/crisis/detector'

/**
 * Drives one guided-path run: step navigation, the per-step answer text, the
 * optional "go deeper" follow-up question, and the finish that captures every
 * answer into the knowledge base. Single-session — no persistence in v1; leaving
 * mid-path discards it. `finish` returns the crisis assessment so the runner can
 * route to /crisis (safety parity with a journal save).
 */
export function useGuidedPath(pathId: string) {
  const path = useMemo<GuidedPath | undefined>(() => getGuidedPath(pathId), [pathId])
  const stepCount = path?.steps.length ?? 0

  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>(() => Array<string>(stepCount).fill(''))
  // The model's follow-up question per step, once the user taps "go deeper".
  const [followUps, setFollowUps] = useState<Array<string | null>>(() =>
    Array<string | null>(stepCount).fill(null)
  )
  const [deepening, setDeepening] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const setAnswer = useCallback((text: string) => {
    setStepIndex((i) => {
      setAnswers((prev) => {
        const next = [...prev]
        next[i] = text
        return next
      })
      return i
    })
  }, [])

  const next = useCallback(() => setStepIndex((i) => Math.min(i + 1, stepCount - 1)), [stepCount])
  const back = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), [])

  /** Ask the deep model for one follow-up question on the current answer. No-op if
   * the answer is empty or the model isn't available. */
  const deepen = useCallback(async () => {
    if (!path) return
    const step = path.steps[stepIndex]
    const answer = answers[stepIndex]?.trim()
    if (!answer) return
    setDeepening(true)
    const res = await deepenReflection({ prompt: step.prompt, answer })
    setDeepening(false)
    if (!res.success) return
    setFollowUps((prev) => {
      const nextFollow = [...prev]
      nextFollow[stepIndex] = res.data
      return nextFollow
    })
  }, [path, stepIndex, answers])

  const finish = useCallback(async (): Promise<CrisisAssessment> => {
    setSubmitting(true)
    const crisis = await capturePathAnswers(answers)
    setSubmitting(false)
    return crisis
  }, [answers])

  return {
    path,
    stepIndex,
    stepCount,
    answer: answers[stepIndex] ?? '',
    followUp: followUps[stepIndex] ?? null,
    isFirst: stepIndex === 0,
    isLast: stepCount > 0 && stepIndex === stepCount - 1,
    // Individual steps are skippable, but a path must capture something to finish.
    hasAnyAnswer: answers.some((a) => a.trim() !== ''),
    deepening,
    submitting,
    setAnswer,
    next,
    back,
    deepen,
    finish,
  }
}
