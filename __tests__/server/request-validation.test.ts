import {
  parseChangePasswordBody,
  parseLoginBody,
  parsePairRedeemBody,
  parseRecoverBody,
  parseRecoveryBody,
  parseRefreshBody,
  parseRegisterBody,
  readJsonBody,
} from '../../server/src/validation/request'

const hash = 'a'.repeat(64)
const escrow = { encrypted_key: 'encrypted-key', salt: 'salt' }

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

describe('Worker request validation', () => {
  it('rejects malformed JSON without exposing the body', async () => {
    const result = await readJsonBody(request('{"password_hash":'))
    expect(result).toBeNull()
  })

  it('rejects bodies over the shared request limit', async () => {
    const result = await readJsonBody(request(JSON.stringify({ value: 'x'.repeat(70_000) })))
    expect(result).toBeNull()
  })

  it('accepts a complete registration body and normalizes email', async () => {
    const body = {
      email: ' User@Example.COM ',
      password_hash: hash,
      key_escrow: escrow,
      recovery_hash: hash,
      recovery_escrow: { encrypted_key: 'recovery-key' },
      device_label: 'Phone',
      platform: 'ios',
      device_id: 'device-1',
    }
    const parsed = parseRegisterBody(await readJsonBody(request(JSON.stringify(body))))
    expect(parsed).toEqual({ ...body, email: 'user@example.com' })
  })

  it.each([
    ['missing required field', { password_hash: hash, key_escrow: escrow, recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' } }],
    ['wrong hash type', { email: 'user@example.com', password_hash: 1, key_escrow: escrow, recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' } }],
    ['non-hex hash', { email: 'user@example.com', password_hash: 'g'.repeat(64), key_escrow: escrow, recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' } }],
    ['unknown field', { email: 'user@example.com', password_hash: hash, key_escrow: escrow, recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' }, extra: true }],
    ['oversized metadata', { email: `${'a'.repeat(250)}@example.com`, password_hash: hash, key_escrow: escrow, recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' } }],
  ])('rejects registration body: %s', (_name, body) => {
    expect(parseRegisterBody(body)).toBeNull()
  })

  it('validates the remaining public and protected body shapes', () => {
    expect(parseLoginBody({ email: 'user@example.com', password_hash: hash })).toEqual({ email: 'user@example.com', password_hash: hash })
    expect(parseRefreshBody({ refresh_token: 'token' })).toEqual({ refresh_token: 'token' })
    expect(parseRecoverBody({ email: 'user@example.com', recovery_hash: hash })).toEqual({ email: 'user@example.com', recovery_hash: hash })
    expect(parsePairRedeemBody({ code: 'code' })).toEqual({ code: 'code' })
    expect(parseRecoveryBody({ recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' } })).toEqual({ recovery_hash: hash, recovery_escrow: { encrypted_key: 'key' } })
    expect(parseChangePasswordBody({ password_hash: hash, key_escrow: escrow })).toEqual({ password_hash: hash, key_escrow: escrow })
  })

  it('rejects wrong types, missing fields, and unknown fields consistently', () => {
    expect(parseLoginBody({ email: 'user@example.com' })).toBeNull()
    expect(parseRefreshBody({ refresh_token: 1 })).toBeNull()
    expect(parseRecoverBody({ email: 'user@example.com', recovery_hash: 'short' })).toBeNull()
    expect(parsePairRedeemBody({ code: 'code', extra: true })).toBeNull()
    expect(parseRecoveryBody({ recovery_hash: hash, recovery_escrow: 'key' })).toBeNull()
    expect(parseChangePasswordBody({ password_hash: hash, key_escrow: escrow, extra: true })).toBeNull()
  })
})
