import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'

export interface Env {
  AUTH_KV: KVNamespace
  R2: R2Bucket
  JWT_SECRET: string
}
