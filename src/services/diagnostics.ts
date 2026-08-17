export type DiagnosticPlatform = 'ios' | 'android' | 'web' | 'unknown'

export interface DiagnosticEvent {
  appVersion: string
  platform: DiagnosticPlatform
  subsystem: string
  code: string
  durationMs?: number
  count?: number
}

const MAX_VERSION_LENGTH = 64
const MAX_SUBSYSTEM_LENGTH = 64
const MAX_CODE_LENGTH = 96
const MAX_COUNT = 1_000_000

function boundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[a-zA-Z0-9._-]+$/.test(value)
}

function isPlatform(value: unknown): value is DiagnosticPlatform {
  return value === 'ios' || value === 'android' || value === 'web' || value === 'unknown'
}

function isFiniteNonNegative(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
}

export function parseDiagnosticEvent(value: unknown): DiagnosticEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  const allowed = new Set(['appVersion', 'platform', 'subsystem', 'code', 'durationMs', 'count'])
  if (keys.some((key) => !allowed.has(key))) return null
  if (
    !boundedIdentifier(input.appVersion, MAX_VERSION_LENGTH) ||
    !isPlatform(input.platform) ||
    !boundedIdentifier(input.subsystem, MAX_SUBSYSTEM_LENGTH) ||
    !boundedIdentifier(input.code, MAX_CODE_LENGTH)
  ) return null
  if (input.durationMs !== undefined && !isFiniteNonNegative(input.durationMs, Number.MAX_SAFE_INTEGER)) return null
  if (input.count !== undefined && (!isFiniteNonNegative(input.count, MAX_COUNT) || !Number.isInteger(input.count))) return null

  return {
    appVersion: input.appVersion,
    platform: input.platform,
    subsystem: input.subsystem,
    code: input.code,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.count === undefined ? {} : { count: input.count }),
  }
}
