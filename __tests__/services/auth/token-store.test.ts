import { saveTokens, getTokens, clearTokens } from '@/services/auth/token-store'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
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

  it('saves then reads the full token set', async () => {
    await saveTokens(tokens)
    expect(await getTokens()).toEqual(tokens)
  })

  it('clears all tokens', async () => {
    await saveTokens(tokens)
    await clearTokens()
    expect(await getTokens()).toBeNull()
  })
})
