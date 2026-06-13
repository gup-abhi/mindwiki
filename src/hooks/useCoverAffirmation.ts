import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { getCoverAffirmation } from '@/services/challenges/cover'

/** The cover affirmation to show at the top of Home, refreshed on focus. */
export function useCoverAffirmation(): string {
  const [affirmation, setAffirmation] = useState('')
  useFocusEffect(
    useCallback(() => {
      void getCoverAffirmation().then(setAffirmation)
    }, [])
  )
  return affirmation
}
