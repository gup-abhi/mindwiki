import { CryptoModule } from '@/native/CryptoModule'
import { LLMBridge } from '@/native/LLMBridge'

describe('native module stubs', () => {
  it('CryptoModule methods reject as not-implemented (contract defined, native pending)', async () => {
    await expect(CryptoModule.deriveKey('pw', 'salt')).rejects.toThrow(/not implemented/)
    await expect(CryptoModule.getKeyFromKeychain()).rejects.toThrow(/not implemented/)
    await expect(CryptoModule.encrypt('x', 'k')).rejects.toThrow(/not implemented/)
    await expect(CryptoModule.decrypt('x', 'k')).rejects.toThrow(/not implemented/)
  })

  it('LLMBridge methods reject as not-implemented', async () => {
    await expect(LLMBridge.loadModel('fast')).rejects.toThrow(/not implemented/)
    await expect(LLMBridge.tag('p', { maxTokens: 10, temperature: 0.1 })).rejects.toThrow(
      /not implemented/
    )
    await expect(
      LLMBridge.synthesise('p', { maxTokens: 10, temperature: 0.7 })
    ).rejects.toThrow(/not implemented/)
  })
})
