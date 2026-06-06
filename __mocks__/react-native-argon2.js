// Manual mock — react-native-argon2 is a native module and cannot load in Jest.
// Returns a deterministic rawHash sized to the requested hashLength (hex), so
// callers that feed it into AES-256 (64 hex chars) get a valid-length key.
module.exports = jest.fn(async (password, salt, opts = {}) => {
  const hashLength = opts.hashLength ?? 32
  return {
    rawHash: 'a'.repeat(hashLength * 2),
    encodedHash: `$argon2id$v=19$m=65536,t=3,p=1$${salt}$deadbeef`,
  }
})
