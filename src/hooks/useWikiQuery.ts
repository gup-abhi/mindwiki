import { useCallback, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { areModelsReady } from '@/services/llm/model-manager'
import { listEntries, type Entry } from '@/services/storage/entries'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { answerQuestion, suggestedQuestions, type WikiAnswer } from '@/services/wiki/query'
import { rankEntries } from '@/services/wiki/search'

const MODELS_MISSING: WikiAnswer = {
  answer:
    'The on-device AI models aren’t downloaded yet. Tap “Download AI models” on the Home screen, then try again.',
  sources: [],
  evidenceCount: 0,
}

/**
 * Wiki query state: loads pages on focus, exposes suggested questions + recent
 * pages, and answers a question grounded in the wiki (best-effort). An optional
 * initialQuestion (e.g. from a Home surfacing card) is asked once, after pages
 * have loaded.
 */
export function useWikiQuery(initialQuestion?: string) {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [answer, setAnswer] = useState<WikiAnswer | null>(null)
  const [related, setRelated] = useState<Entry[]>([])
  const [asking, setAsking] = useState(false)
  const askedInitial = useRef(false)
  // Identifies the in-flight request; clear() or a new ask bumps it so a
  // superseded answer's result is ignored when it eventually resolves (the
  // deep model can't be aborted mid-inference, so we just drop stale output).
  const reqId = useRef(0)

  const runAnswer = useCallback(async (question: string, pgs: WikiPage[], ents: Entry[]) => {
    if (!question.trim()) return
    const id = ++reqId.current
    setAsking(true)
    setAnswer(null)
    setRelated([])
    // Answering runs the deep model — if it isn't downloaded, say so (and point at
    // the Home download card) instead of a generic failure.
    if (!(await areModelsReady())) {
      if (reqId.current !== id) return
      setAnswer(MODELS_MISSING)
      setAsking(false)
      return
    }
    const res = await answerQuestion(question, pgs)
    if (reqId.current !== id) return // cleared or superseded while answering
    const ans = res.success
      ? res.data
      : { answer: 'Something went wrong answering that — please try again.', sources: [], evidenceCount: 0 }
    setAnswer(ans)
    // Rank entries against the question *plus* the matched page topics, so an
    // answer from the "Anxiety" page also surfaces entries tagged anxiety even
    // when the question never used that exact word.
    const expanded = [question, ...ans.sources.map((s) => s.title)].join(' ')
    setRelated(rankEntries(expanded, ents, 5))
    setAsking(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      Promise.all([listPages(), listEntries(200)]).then(([p, e]) => {
        const pgs = p.success ? p.data : []
        const ents = e.success ? e.data : []
        setPages(pgs)
        setEntries(ents)
        if (initialQuestion && !askedInitial.current) {
          askedInitial.current = true
          runAnswer(initialQuestion, pgs, ents)
        }
      })
    }, [initialQuestion, runAnswer])
  )

  const ask = useCallback(
    (question: string) => runAnswer(question, pages, entries),
    [pages, entries, runAnswer]
  )

  // Reset to the pre-question state (suggestions + recent pages). Bumping reqId
  // cancels any in-flight answer so it won't land after the user has moved on.
  const clear = useCallback(() => {
    reqId.current++
    setAnswer(null)
    setRelated([])
    setAsking(false)
  }, [])

  const suggestions = useMemo(() => suggestedQuestions(pages), [pages])
  const recentPages = useMemo(
    () => [...pages].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5),
    [pages]
  )

  return { suggestions, recentPages, answer, related, asking, ask, clear }
}
