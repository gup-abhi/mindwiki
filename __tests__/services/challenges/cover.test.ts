import {
  COVER_AFFIRMATION_TTL_MS,
  getCoverAffirmation,
  setCoverAffirmation,
} from '@/services/challenges/cover'

const mockStore = new Map<string, string>()
jest.mock('@/services/storage/settings', () => ({
  async getSetting(key: string) {
    return { success: true, data: mockStore.has(key) ? mockStore.get(key) : null }
  },
  async setSetting(key: string, value: string) {
    mockStore.set(key, value)
    return { success: true, data: undefined }
  },
}))

beforeEach(() => mockStore.clear())

describe('challenges/cover', () => {
  it('returns an empty string when no cover affirmation is set', async () => {
    expect(await getCoverAffirmation()).toBe('')
  })

  it('round-trips a promoted affirmation within the window', async () => {
    await setCoverAffirmation('I finish what I start.')
    expect(await getCoverAffirmation()).toBe('I finish what I start.')
  })

  it('stops returning the affirmation once it is older than the TTL', async () => {
    const stale = Date.now() - COVER_AFFIRMATION_TTL_MS - 1000
    mockStore.set(
      'challenge_cover_affirmation',
      JSON.stringify({ text: 'Old reward.', setAt: stale })
    )
    expect(await getCoverAffirmation()).toBe('')
  })

  it('still shows a legacy plain-string cover (no timestamp)', async () => {
    mockStore.set('challenge_cover_affirmation', 'Legacy line.')
    expect(await getCoverAffirmation()).toBe('Legacy line.')
  })
})
