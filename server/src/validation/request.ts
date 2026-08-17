const MAX_REQUEST_BODY_BYTES = 64 * 1024
const MAX_EMAIL_LENGTH = 254
const MAX_HASH_LENGTH = 64
const MAX_ESCROW_VALUE_LENGTH = 8 * 1024
const MAX_DEVICE_VALUE_LENGTH = 256
const MAX_REFRESH_TOKEN_LENGTH = 256
const MAX_PAIRING_CODE_LENGTH = 128

interface RegisterBody {
  email: string
  password_hash: string
  key_escrow: { encrypted_key: string; salt: string }
  recovery_hash: string
  recovery_escrow: { encrypted_key: string }
  device_label?: string
  platform?: string
  device_id?: string
}

interface LoginBody {
  email: string
  password_hash: string
  device_label?: string
  platform?: string
  device_id?: string
}

interface RecoverBody {
  email: string
  recovery_hash: string
  device_label?: string
  platform?: string
  device_id?: string
}

interface PairRedeemBody {
  code: string
  device_label?: string
  platform?: string
  device_id?: string
}

interface RecoveryBody {
  recovery_hash: string
  recovery_escrow: { encrypted_key: string }
}

interface ChangePasswordBody {
  password_hash: string
  key_escrow: { encrypted_key: string; salt: string }
}

interface RefreshBody {
  refresh_token: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key))
}

function boundedString(value: unknown, maxLength: number, minLength = 1): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
}

function hashValue(value: unknown): value is string {
  return boundedString(value, MAX_HASH_LENGTH, MAX_HASH_LENGTH) && /^[0-9a-f]{64}$/i.test(value)
}

function emailValue(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function metadata(value: unknown): value is string | undefined {
  return value === undefined || boundedString(value, MAX_DEVICE_VALUE_LENGTH)
}

function escrow(value: unknown): value is { encrypted_key: string; salt: string } {
  return isPlainObject(value) &&
    hasOnlyKeys(value, ['encrypted_key', 'salt']) &&
    boundedString(value.encrypted_key, MAX_ESCROW_VALUE_LENGTH) &&
    boundedString(value.salt, MAX_ESCROW_VALUE_LENGTH)
}

function recoveryEscrow(value: unknown): value is { encrypted_key: string } {
  return isPlainObject(value) &&
    hasOnlyKeys(value, ['encrypted_key']) &&
    boundedString(value.encrypted_key, MAX_ESCROW_VALUE_LENGTH)
}

export async function readJsonBody(req: Request): Promise<unknown | null> {
  const declaredLength = req.headers.get('Content-Length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_REQUEST_BODY_BYTES) return null
  }
  if (!req.body) return null

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  try {
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return null
  }
}

export function parseRegisterBody(value: unknown): RegisterBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['email', 'password_hash', 'key_escrow', 'recovery_hash', 'recovery_escrow'], ['device_label', 'platform', 'device_id'])) return null
  if (!emailValue(value.email) || !hashValue(value.password_hash) || !escrow(value.key_escrow) || !hashValue(value.recovery_hash) || !recoveryEscrow(value.recovery_escrow)) return null
  if (!metadata(value.device_label) || !metadata(value.platform) || !metadata(value.device_id)) return null
  return { ...value, email: value.email.trim().toLowerCase() } as RegisterBody
}

export function parseLoginBody(value: unknown): LoginBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['email', 'password_hash'], ['device_label', 'platform', 'device_id'])) return null
  if (!emailValue(value.email) || !hashValue(value.password_hash) || !metadata(value.device_label) || !metadata(value.platform) || !metadata(value.device_id)) return null
  return { ...value, email: value.email.trim().toLowerCase() } as LoginBody
}

export function parseRecoverBody(value: unknown): RecoverBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['email', 'recovery_hash'], ['device_label', 'platform', 'device_id'])) return null
  if (!emailValue(value.email) || !hashValue(value.recovery_hash) || !metadata(value.device_label) || !metadata(value.platform) || !metadata(value.device_id)) return null
  return { ...value, email: value.email.trim().toLowerCase() } as RecoverBody
}

export function parsePairRedeemBody(value: unknown): PairRedeemBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['code'], ['device_label', 'platform', 'device_id'])) return null
  if (!boundedString(value.code, MAX_PAIRING_CODE_LENGTH) || !metadata(value.device_label) || !metadata(value.platform) || !metadata(value.device_id)) return null
  return value as unknown as PairRedeemBody
}

export function parseRecoveryBody(value: unknown): RecoveryBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['recovery_hash', 'recovery_escrow'])) return null
  if (!hashValue(value.recovery_hash) || !recoveryEscrow(value.recovery_escrow)) return null
  return value as unknown as RecoveryBody
}

export function parseChangePasswordBody(value: unknown): ChangePasswordBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['password_hash', 'key_escrow'])) return null
  if (!hashValue(value.password_hash) || !escrow(value.key_escrow)) return null
  return value as unknown as ChangePasswordBody
}

export function parseRefreshBody(value: unknown): RefreshBody | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['refresh_token'])) return null
  if (!boundedString(value.refresh_token, MAX_REFRESH_TOKEN_LENGTH)) return null
  return value as unknown as RefreshBody
}
