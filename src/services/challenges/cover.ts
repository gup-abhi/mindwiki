import { getSetting, setSetting } from '@/services/storage/settings'
import { type Result } from '@/types/result'

// The affirmation shown on the post-unlock cover screen. Stored in the encrypted
// settings table (read only after the DB is unlocked — see the "option 2" privacy
// choice: the cover appears *after* the password, never before), so it never
// leaves the device and isn't readable without the master key.
const COVER_AFFIRMATION_KEY = 'challenge_cover_affirmation'

// The cover only flashes for a week after it's earned, then retires from the
// launch experience — long enough to savor, short of becoming a permanent
// interstitial. Finishing another challenge resets the window.
export const COVER_AFFIRMATION_TTL_MS = 7 * 86_400_000

interface StoredCover {
  text: string
  setAt: number
}

/**
 * The user's chosen cover affirmation, or '' when none is set or it has expired
 * (older than COVER_AFFIRMATION_TTL_MS). Legacy plain-string values (no
 * timestamp) are returned without expiry.
 */
export async function getCoverAffirmation(): Promise<string> {
  const res = await getSetting(COVER_AFFIRMATION_KEY)
  if (!(res.success && res.data)) return ''
  try {
    const parsed = JSON.parse(res.data) as Partial<StoredCover>
    if (typeof parsed.text === 'string' && typeof parsed.setAt === 'number') {
      return Date.now() - parsed.setAt <= COVER_AFFIRMATION_TTL_MS ? parsed.text : ''
    }
  } catch {
    // Not JSON — a legacy plain-string cover; show it without an expiry.
  }
  return res.data
}

/** Promote an unlocked affirmation to the cover screen, stamping it now. */
export function setCoverAffirmation(text: string): Promise<Result<void>> {
  const value: StoredCover = { text, setAt: Date.now() }
  return setSetting(COVER_AFFIRMATION_KEY, JSON.stringify(value))
}
