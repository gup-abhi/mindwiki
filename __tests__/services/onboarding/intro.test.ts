import * as SecureStore from 'expo-secure-store'

import { isIntroOnboardingDone, markIntroOnboardingDone } from '@/services/onboarding/intro'

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock

describe('intro onboarding persistence', () => {
  beforeEach(() => {
    mockGetItemAsync.mockReset()
    mockSetItemAsync.mockReset()
  })

  it('is incomplete until the install-level marker exists', async () => {
    mockGetItemAsync.mockResolvedValue(null)
    expect(await isIntroOnboardingDone()).toBe(false)
  })

  it('recognizes the completed marker', async () => {
    mockGetItemAsync.mockResolvedValue('1')
    expect(await isIntroOnboardingDone()).toBe(true)
  })

  it('persists completion outside the account database', async () => {
    mockSetItemAsync.mockResolvedValue(undefined)
    await markIntroOnboardingDone()
    expect(mockSetItemAsync).toHaveBeenCalledWith('mindwiki.intro_onboarding_done', '1')
  })

  it('fails open without blocking account access', async () => {
    mockGetItemAsync.mockRejectedValue(new Error('keystore unavailable'))
    mockSetItemAsync.mockRejectedValue(new Error('keystore unavailable'))
    expect(await isIntroOnboardingDone()).toBe(false)
    await expect(markIntroOnboardingDone()).resolves.toBeUndefined()
  })
})
