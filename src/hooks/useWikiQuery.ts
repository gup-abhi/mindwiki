import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listPages, type WikiPage } from '@/services/storage/wiki'
import { answerQuestion, suggestedQuestions, type WikiAnswer } from '@/services/wiki/query'

/**
 * Wiki query state: loads pages on focus, exposes suggested questions + recent
 * pages, and answers a question grounded in the wiki (best-effort).
 */
export function useWikiQuery() {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [answer, setAnswer] = useState<WikiAnswer | null>(null)
  const [asking, setAsking] = useState(false)

  useFocusEffect(
    useCallback(() => {
      listPages().then((r) => {
        if (r.success) setPages(r.data)
      })
    }, [])
  )

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim()) return
      setAsking(true)
      setAnswer(null)
      const res = await answerQuestion(question, pages)
      setAnswer(
        res.success
          ? res.data
          : { answer: 'Something went wrong answering that — please try again.', sources: [], evidenceCount: 0 }
      )
      setAsking(false)
    },
    [pages]
  )

  const suggestions = useMemo(() => suggestedQuestions(pages), [pages])
  const recentPages = useMemo(
    () => [...pages].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5),
    [pages]
  )

  return { suggestions, recentPages, answer, asking, ask }
}
