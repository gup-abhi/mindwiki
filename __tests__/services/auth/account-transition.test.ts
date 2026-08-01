import * as SecureStore from 'expo-secure-store'

import { getAccountTransition, setAccountTransition } from '@/services/auth/account-transition'

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}))

jest.mock('@/services/storage/db', () => ({
  beginWipe: jest.fn(),
  deleteDatabase: jest.fn(() => true),
  endWipe: jest.fn(),
}))

jest.mock('@/services/auth/token-store', () => ({
  clearTokens: jest.fn(),
  saveTokens: jest.fn(),
}))

jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: {
    deleteKeyFromKeychain: jest.fn(),
    deleteKeyOwner: jest.fn(),
    setKeyInKeychain: jest.fn(),
    setKeyOwner: jest.fn(),
  },
}))

const transition = {
  accountId: 'acc',
  masterKey: 'a'.repeat(64),
  tokens: { accessToken: 'at', refreshToken: 'rt', accountId: 'acc' },
}

describe('account-transition SecureStore migration', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes account transition state as device-only', async () => {
    await setAccountTransition(transition)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'mindwiki.account_transition',
      JSON.stringify(transition),
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
    )
  })

  it('returns a readable legacy transition even when best-effort hardening fails', async () => {
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(transition))
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('keychain write failed'))

    await expect(getAccountTransition()).resolves.toEqual(transition)
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  })
})