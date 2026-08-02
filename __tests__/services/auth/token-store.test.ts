import * as SecureStore from 'expo-secure-store'

import { saveTokens, getTokens, clearTokens } from '@/services/auth/token-store'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k)
    }),
  }
})

const tokens = { accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' }

describe('auth token-store', () => {
  it('returns null when nothing is stored', async () => {
    await clearTokens()
    expect(await getTokens()).toBeNull()
  })

  it('saves then reads the full token set with device-only keychain accessibility', async () => {
    await saveTokens(tokens)
    expect(await getTokens()).toEqual(tokens)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'mindwiki.auth_session',
      JSON.stringify(tokens),
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
    )
  })

  it('returns readable legacy tokens when best-effort hardening rewrite fails', async () => {
    await saveTokens(tokens)
    ;(SecureStore.deleteItemAsync as jest.Mock).mockClear()
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain write failed'))
    await expect(getTokens()).resolves.toEqual(tokens)
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith('mindwiki.auth_session')
  })

  it('clears all tokens', async () => {
    await saveTokens(tokens)
    await clearTokens()
    expect(await getTokens()).toBeNull()
  })
})
