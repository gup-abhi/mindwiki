import { getCoverAffirmation, setCoverAffirmation } from '@/services/challenges/cover'

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

  it('round-trips a promoted affirmation', async () => {
    await setCoverAffirmation('I finish what I start.')
    expect(await getCoverAffirmation()).toBe('I finish what I start.')
  })
})
