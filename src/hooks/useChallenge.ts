import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  type Challenge,
  type NewChallenge,
  createChallenge,
  deleteChallenge,
  getActiveChallenge,
} from '@/services/storage/challenges'
import {
  type CheckinResult,
  effectiveStreak,
  isDoneToday,
  recordCheckin,
} from '@/services/challenges/checkin'
import {
  cancelChallengeReminders,
  ensurePermission,
  scheduleChallengeReminders,
} from '@/services/notifications/scheduler'

/**
 * The active 30-day challenge (one at a time) for the Home card + create flow.
 * Loads on focus and orchestrates storage with the morning-nudge notifications:
 * creating arms them, a check-in re-arms them (or cancels on completion), and
 * removing cancels them. `checkIn` returns the result so the screen can fire a
 * completion celebration. All state is derived against `now` at call time so the
 * streak reads correctly even if a day lapsed while the screen was closed.
 */
export function useChallenge() {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const res = await getActiveChallenge()
    setChallenge(res.success ? res.data : null)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  const create = useCallback(
    async (input: NewChallenge): Promise<Challenge | null> => {
      setBusy(true)
      try {
        const res = await createChallenge(input)
        if (!res.success) return null
        await ensurePermission()
        void scheduleChallengeReminders(res.data, Date.now(), false)
        setChallenge(res.data)
        return res.data
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const checkIn = useCallback(async (): Promise<CheckinResult | null> => {
    if (!challenge) return null
    setBusy(true)
    try {
      const now = Date.now()
      const res = await recordCheckin(challenge.id, now)
      if (!res.success) return null
      const updated = res.data.challenge
      if (updated.status === 'completed') {
        void cancelChallengeReminders(updated.id)
      } else {
        void scheduleChallengeReminders(updated, now, true) // just done today
      }
      setChallenge(updated.status === 'completed' ? null : updated)
      return res.data
    } finally {
      setBusy(false)
    }
  }, [challenge])

  const remove = useCallback(async () => {
    if (!challenge) return
    void cancelChallengeReminders(challenge.id)
    await deleteChallenge(challenge.id)
    setChallenge(null)
  }, [challenge])

  const now = Date.now()
  return {
    challenge,
    loading,
    busy,
    streak: challenge ? effectiveStreak(challenge, now) : 0,
    doneToday: challenge ? isDoneToday(challenge, now) : false,
    create,
    checkIn,
    remove,
    refresh,
  }
}
