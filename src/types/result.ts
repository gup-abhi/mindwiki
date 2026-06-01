// Result<T, E> — services return this instead of throwing. See ADR 004.

export interface AppError {
  code: string
  message: string
  cause?: unknown
}

export type Result<T, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E }

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data }
}

export function err(code: string, message: string, cause?: unknown): Result<never, AppError> {
  return { success: false, error: { code, message, cause } }
}
