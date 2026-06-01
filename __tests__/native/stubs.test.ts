import { CryptoModule } from '@/native/CryptoModule'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
  }
})

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(0xab)),
}))

describe('CryptoModule', () => {
  it('getKeyFromKeychain generates a 256-bit hex key and reuses it', async () => {
    const first = await CryptoModule.getKeyFromKeychain()
    expect(first).toHaveLength(64) // 32 bytes as hex
    const second = await CryptoModule.getKeyFromKeychain()
    expect(second).toBe(first) // persisted, not regenerated
  })

  it('still treats password/AES paths as not-implemented (native pending)', async () => {
    await expect(CryptoModule.deriveKey('pw', 'salt')).rejects.toThrow(/not implemented/)
    await expect(CryptoModule.encrypt('x', 'k')).rejects.toThrow(/not implemented/)
    await expect(CryptoModule.decrypt('x', 'k')).rejects.toThrow(/not implemented/)
  })
})

describe('LLMBridge stubs', () => {
  it('methods reject as not-implemented (native pending Phase 2)', async () => {
    await expect(LLMBridge.loadModel('fast')).rejects.toThrow(/not implemented/)
    await expect(LLMBridge.tag('p', { maxTokens: 10, temperature: 0.1 })).rejects.toThrow(
      /not implemented/
    )
    await expect(
      LLMBridge.synthesise('p', { maxTokens: 10, temperature: 0.7 })
    ).rejects.toThrow(/not implemented/)
  })
})
