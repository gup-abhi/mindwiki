import { useCallback, useReducer, useRef } from 'react'

import { findExistingBeliefMatch } from '@/services/untangle/thought-match'
import { suggestUntanglePatterns, suggestUntangleReframes } from '@/services/untangle/service'
import { type UntangleReframeCandidates } from '@/services/untangle/service'
import { hasCrisisKeyword, assessCrisis } from '@/services/crisis/detector'
import { buildObservations } from '@/services/untangle/evidence'
import { type Observation } from '@/services/untangle/evidence'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { listNodes, listEdges, type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { createReframe } from '@/services/storage/reframes'

export type UntangleStep = 'idle' | 'crisis' | 'loading' | 'ready' | 'error'

export interface UntangleState {
  step: UntangleStep
  stage: number
  thought: string
  patterns: string[]
  selectedPatterns: string[]
  observations: Observation[]
  candidates: UntangleReframeCandidates | null
  candidateLoading: boolean
  candidateErrorCode: string | null
  matchedBelief: string | null
  error: boolean
}

type Action =
  | { type: 'RESET' }
  | { type: 'START_LOADING'; thought: string }
  | { type: 'CRISIS' }
  | { type: 'LOAD_ERROR' }
  | {
      type: 'SUCCESS'
      patterns: string[]
      matchedBelief: string | null
      observations: Observation[]
    }
  | { type: 'NEXT_STAGE'; stage: number }
  | { type: 'PREVIOUS_STAGE'; stage: number }
  | { type: 'SET_SELECTED'; patterns: string[] }
  | { type: 'START_CANDIDATES' }
  | { type: 'SET_CANDIDATES'; candidates: UntangleReframeCandidates }
  | { type: 'SET_CANDIDATE_ERROR'; code: string }

function reducer(s: UntangleState, a: Action): UntangleState {
  switch (a.type) {
    case 'RESET':
      return {
        step: 'idle',
        stage: 0,
        thought: '',
        patterns: [],
        selectedPatterns: [],
        observations: [],
        candidates: null,
        candidateLoading: false,
        candidateErrorCode: null,
        matchedBelief: null,
        error: false,
      }
    case 'START_LOADING':
      return { ...s, step: 'loading', error: false, thought: a.thought }
    case 'CRISIS':
      return { ...s, step: 'crisis' }
    case 'LOAD_ERROR':
      return { ...s, step: 'error', error: true }
    case 'SUCCESS':
      return {
        ...s,
        step: 'ready',
        stage: 1,
        patterns: a.patterns,
        selectedPatterns: [...a.patterns],
        observations: a.observations,
        matchedBelief: a.matchedBelief,
      }
    case 'NEXT_STAGE':
      return s.stage >= 4 ? s : { ...s, stage: a.stage }
    case 'PREVIOUS_STAGE':
      if (s.stage <= 0) return s
      // Returning to Catch — reset step to idle so the text field is editable,
      // and clear transient errors.
      if (a.stage === 0) {
        return { ...s, stage: 0, step: 'idle', error: false, candidateErrorCode: null, patterns: [], selectedPatterns: [], observations: [] }
      }
      return { ...s, stage: a.stage, error: false, candidateErrorCode: null }
    case 'SET_SELECTED':
      return { ...s, selectedPatterns: a.patterns }
    case 'START_CANDIDATES':
      return { ...s, candidateLoading: true, candidateErrorCode: null, error: false }
    case 'SET_CANDIDATES':
      return {
        ...s,
        candidates: a.candidates,
        candidateLoading: false,
        candidateErrorCode: null,
        error: false,
      }
    case 'SET_CANDIDATE_ERROR':
      return { ...s, candidateLoading: false, candidateErrorCode: a.code, error: true }
  }
}

const INITIAL: UntangleState = {
  step: 'idle',
  stage: 0,
  thought: '',
  patterns: [],
  selectedPatterns: [],
  observations: [],
  candidates: null,
  candidateLoading: false,
  candidateErrorCode: null,
  matchedBelief: null,
  error: false,
}

async function loadUntangleContext(): Promise<{
  pages: WikiPage[]
  nodes: GraphNode[]
  edges: GraphEdge[]
}> {
  const [pagesResult, nodesResult, edgesResult] = await Promise.all([
    listPages(),
    listNodes(),
    listEdges(),
  ])
  return {
    pages: pagesResult.success ? pagesResult.data : [],
    nodes: nodesResult.success ? nodesResult.data : [],
    edges: edgesResult.success ? edgesResult.data : [],
  }
}

export function useUntangleThought() {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const ctxRef = useRef(state)
  ctxRef.current = state
  const sessionRef = useRef(0)

  const submitThought = useCallback(async (thought: string) => {
    const trimmed = thought.trim()
    if (!trimmed) return

    const token = ++sessionRef.current
    dispatch({ type: 'START_LOADING', thought: trimmed })

    try {
      const keywordMatch = hasCrisisKeyword(trimmed)
      const crisis = assessCrisis(trimmed, 0)
      if (keywordMatch || crisis.tier >= 2) {
        if (token === sessionRef.current) dispatch({ type: 'CRISIS' })
        return
      }

      const [patternRes, beliefRes, context] = await Promise.all([
        suggestUntanglePatterns(trimmed),
        findExistingBeliefMatch(trimmed),
        loadUntangleContext(),
      ])

      if (token !== sessionRef.current) return
      if (!patternRes.success) {
        dispatch({ type: 'LOAD_ERROR' })
        return
      }

      dispatch({
        type: 'SUCCESS',
        patterns: patternRes.data.patterns,
        matchedBelief: beliefRes.belief,
        observations: buildObservations(
          trimmed,
          context.pages,
          context.nodes,
          context.edges
        ).observations,
      })
    } catch {
      if (token === sessionRef.current) dispatch({ type: 'LOAD_ERROR' })
    }
  }, [])

  const next = useCallback(() => {
    const current = ctxRef.current
    if (current.stage < 4) dispatch({ type: 'NEXT_STAGE', stage: current.stage + 1 })
  }, [])

  const previous = useCallback(() => {
    const current = ctxRef.current
    if (current.stage > 0) dispatch({ type: 'PREVIOUS_STAGE', stage: current.stage - 1 })
  }, [])

  const setSelectedPatterns = useCallback((patterns: string[]) => {
    dispatch({ type: 'SET_SELECTED', patterns })
  }, [])

  const generateCandidates = useCallback(async (): Promise<boolean> => {
    const token = sessionRef.current
    const current = ctxRef.current
    if (current.stage !== 3 && current.stage !== 4) return false

    dispatch({ type: 'START_CANDIDATES' })
    const result = await suggestUntangleReframes({
      thought: current.thought,
      patterns: current.selectedPatterns,
      sources: current.observations.map((o) => ({ title: o.title, excerpt: o.excerpt })),
    })
    if (token !== sessionRef.current) return false
    if (result.success) {
      dispatch({ type: 'SET_CANDIDATES', candidates: result.data })
      return true
    }
    dispatch({ type: 'SET_CANDIDATE_ERROR', code: result.error.code })
    return false
  }, [])

  const finishReframe = useCallback(async (): Promise<boolean> => {
    const current = ctxRef.current
    if (!current.candidates || !current.matchedBelief) return false

    const result = await createReframe({
      belief: current.matchedBelief,
      balanced_thought: current.candidates.factual,
      evidence_for: '',
      evidence_against: '',
    })
    return result.success
  }, [])

  const cancel = useCallback(() => {
    sessionRef.current += 1
    dispatch({ type: 'RESET' })
  }, [])

  return {
    ...state,
    submitThought,
    next,
    previous,
    setSelectedPatterns,
    generateCandidates,
    finishReframe,
    cancel,
  }
}
