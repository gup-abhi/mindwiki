import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'

import { prepareCheckin } from '@/services/pursuits/checkin'
import { updatePursuit, type Pursuit } from '@/services/storage/pursuits'

/**
 * Drives the Home "Checking in" card: on focus, resolves the pursuit that's due
 * for a check-in (if any) and its question. `open` routes into Reflect on that
 * thread; `dismiss` defers it. Both stamp last_checkin_at, which resets the
 * pursuit's cadence and trips the one-per-day cooldown so the next focus is quiet.
 */
export function usePursuitCheckin() {
  const router = useRouter()
  const [checkin, setCheckin] = useState<Pursuit | null>(null)

  useFocusEffect(
    useCallback(() => {
      let active = true
      prepareCheckin().then((p) => {
        if (active) setCheckin(p)
      })
      return () => {
        active = false
      }
    }, [])
  )

  // Record that the pursuit was surfaced (best-effort) and clear the card.
  const stamp = useCallback((p: Pursuit) => {
    setCheckin(null)
    void updatePursuit(p.id, { last_checkin_at: Date.now() })
  }, [])

  const open = useCallback(() => {
    if (!checkin) return
    // Route as a check-in (ask), not a starter (q): the question opens as the
    // companion's message and the user answers it.
    const ask = checkin.checkin_question
    stamp(checkin)
    router.push({ pathname: '/query', params: { ask } })
  }, [checkin, router, stamp])

  const dismiss = useCallback(() => {
    if (checkin) stamp(checkin)
  }, [checkin, stamp])

  return { checkin, open, dismiss }
}
