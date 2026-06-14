import { useEffect, useState } from 'react'

import { AffirmationCover } from '@/components/AffirmationCover'
import { getCoverAffirmation } from '@/services/challenges/cover'

// Shown once per app launch (a fresh JS context resets this). A lock/unlock
// later in the same session won't replay it.
let coverShownThisLaunch = false

/**
 * The app-open affirmation flash: shows the user's earned affirmation over the
 * app on launch (after unlock, so it reads from the open encrypted DB) and then
 * fades away to reveal Home. Renders nothing when no affirmation is set or it has
 * expired — the common case, since one is only earned by finishing a challenge.
 */
export function CoverScreen() {
  const [affirmation, setAffirmation] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (coverShownThisLaunch) {
      setDone(true)
      return
    }
    let active = true
    void getCoverAffirmation().then((a) => {
      if (!active) return
      if (!a) {
        setDone(true)
        return
      }
      coverShownThisLaunch = true
      setAffirmation(a)
    })
    return () => {
      active = false
    }
  }, [])

  if (done || affirmation == null) return null
  return <AffirmationCover affirmation={affirmation} onDismiss={() => setDone(true)} />
}
