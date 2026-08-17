import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  createReframe,
  listReframesForBelief,
  type BeliefReframe,
} from '@/services/storage/reframes'
import { suggestBalancedThought } from '@/services/llm/deep-model'
import { type Result } from '@/types/result'
import { useSyncStore } from '@/store/sync.store'

export interface ReframeInput {
  evidence_for: string
  evidence_against: string
  balanced_thought: string
}

/**
 * The reframes a user has written for a belief, plus the actions to add one and
 * to ask the on-device model for a balanced-thought suggestion. Reloads on focus
 * and when sync advances the revision. `belief` is the stable label identity.
 */
export function useReframes(belief: string | null) {
  const [reframes, setReframes] = useState<BeliefReframe[]>([])
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    if (!belief) {
      setReframes([])
      return
    }
    const res = await listReframesForBelief(belief)
    if (res.success) setReframes(res.data)
  }, [belief])

  useFocusEffect(
    useCallback(() => {
      void revision
      void refresh()
    }, [refresh, revision])
  )

  const save = useCallback(
    async (input: ReframeInput): Promise<Result<BeliefReframe> | null> => {
      if (!belief) return null
      const res = await createReframe({ belief, ...input })
      if (res.success) await refresh()
      return res
    },
    [belief, refresh]
  )

  const suggest = useCallback(
    (evidenceFor: string, evidenceAgainst: string): Promise<Result<string>> | null => {
      if (!belief) return null
      return suggestBalancedThought({ belief, evidenceFor, evidenceAgainst })
    },
    [belief]
  )

  return { reframes, refresh, save, suggest }
}
