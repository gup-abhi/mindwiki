import { useCallback, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listPages, type WikiPage } from '@/services/storage/wiki'
import { answerQuestion, suggestedQuestions, type WikiAnswer } from '@/services/wiki/query'

/**
 * Wiki query state: loads pages on focus, exposes suggested questions + recent
 * pages, and answers a question grounded in the wiki (best-effort). An optional
 * initialQuestion (e.g. from a Home surfacing card) is asked once, after pages
 * have loaded.
 */
export function useWikiQuery(initialQuestion?: string) {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [answer, setAnswer] = useState<WikiAnswer | null>(null)
  const [asking, setAsking] = useState(false)
  const askedInitial = useRef(false)

  const runAnswer = useCallback(async (question: string, pgs: WikiPage[]) => {
    if (!question.trim()) return
    setAsking(true)
    setAnswer(null)
    const res = await answerQuestion(question, pgs)
    setAnswer(
      res.success
        ? res.data
        : { answer: 'Something went wrong answering that — please try again.', sources: [], evidenceCount: 0 }
    )
    setAsking(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      listPages().then((r) => {
        if (!r.success) return
        setPages(r.data)
        if (initialQuestion && !askedInitial.current) {
          askedInitial.current = true
          runAnswer(initialQuestion, r.data)
        }
      })
    }, [initialQuestion, runAnswer])
  )

  const ask = useCallback((question: string) => runAnswer(question, pages), [pages, runAnswer])

  const suggestions = useMemo(() => suggestedQuestions(pages), [pages])
  const recentPages = useMemo(
    () => [...pages].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5),
    [pages]
  )

  return { suggestions, recentPages, answer, asking, ask }
}
