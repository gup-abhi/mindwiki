import {
  setWipePending,
  clearWipePending,
  isWipePending,
  repairInterruptedWipe,
} from '@/services/auth/wipe-marker'
import { clearTokens } from '@/services/auth/token-store'
import { deleteDatabase } from '@/services/storage/db'
import { CryptoModule } from '@/native/CryptoModule'

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

jest.mock('@/services/storage/db', () => ({ deleteDatabase: jest.fn() }))
jest.mock('@/services/auth/token-store', () => ({ clearTokens: jest.fn() }))
jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: {
    deleteKeyFromKeychain: jest.fn(),
    deleteKeyOwner: jest.fn(),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('wipe-marker', () => {
  it('round-trips the pending flag', async () => {
    expect(await isWipePending()).toBe(false)
    await setWipePending()
    expect(await isWipePending()).toBe(true)
    await clearWipePending()
    expect(await isWipePending()).toBe(false)
  })

  it('repairInterruptedWipe is a no-op when no wipe is pending', async () => {
    await repairInterruptedWipe()
    expect(deleteDatabase).not.toHaveBeenCalled()
    expect(CryptoModule.deleteKeyFromKeychain).not.toHaveBeenCalled()
    expect(clearTokens).not.toHaveBeenCalled()
  })

  it('repairInterruptedWipe finishes an interrupted logout wipe (idempotent)', async () => {
    await setWipePending()
    await repairInterruptedWipe()
    expect(deleteDatabase).toHaveBeenCalled()
    expect(CryptoModule.deleteKeyFromKeychain).toHaveBeenCalled()
    expect(CryptoModule.deleteKeyOwner).toHaveBeenCalled()
    expect(clearTokens).toHaveBeenCalled()
    expect(await isWipePending()).toBe(false)
  })
})
