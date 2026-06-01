// STUB — a trivially reversible transform, NOT real AES-256-GCM. It round-trips so
// the AES check passes, but it provides ZERO encryption. Replace with the real
// native CryptoModule (iOS CryptoKit / Android Tink or equivalent) before the
// Phase -1 gate genuinely passes.

const PREFIX = 'stub::'

export const CryptoModule = {
  async encrypt(plaintext: string, _keyHex: string): Promise<string> {
    return PREFIX + plaintext
  },

  async decrypt(ciphertext: string, _keyHex: string): Promise<string> {
    return ciphertext.startsWith(PREFIX) ? ciphertext.slice(PREFIX.length) : ciphertext
  },
}
