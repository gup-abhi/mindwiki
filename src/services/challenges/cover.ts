import { getSetting, setSetting } from '@/services/storage/settings'
import { type Result } from '@/types/result'

// The affirmation shown on the post-unlock cover screen. Stored in the encrypted
// settings table (read only after the DB is unlocked — see the "option 2" privacy
// choice: the cover appears *after* the password, never before), so it never
// leaves the device and isn't readable without the master key.
const COVER_AFFIRMATION_KEY = 'challenge_cover_affirmation'

/** The user's chosen cover affirmation, or '' when none is set. */
export async function getCoverAffirmation(): Promise<string> {
  const res = await getSetting(COVER_AFFIRMATION_KEY)
  return res.success && res.data ? res.data : ''
}

/** Promote an unlocked affirmation to the cover screen. */
export function setCoverAffirmation(text: string): Promise<Result<void>> {
  return setSetting(COVER_AFFIRMATION_KEY, text)
}
