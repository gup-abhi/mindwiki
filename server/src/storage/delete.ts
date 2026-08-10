import type { Env } from '../types'

const R2_DELETE_BATCH_SIZE = 1_000

interface AccountOwnedRecord {
  account_id?: unknown
}

async function deleteR2Objects(env: Env, accountId: string): Promise<void> {
  while (true) {
    const listed = await env.R2.list({ prefix: `${accountId}/`, limit: R2_DELETE_BATCH_SIZE })
    const keys = listed.objects.map((object) => object.key)
    if (keys.length === 0) return
    await env.R2.delete(keys)
  }
}

async function deleteMatchingKvRecords(
  env: Env,
  prefix: string,
  accountId: string
): Promise<void> {
  const names: string[] = []
  let cursor: string | undefined
  do {
    const listed = await env.AUTH_KV.list({ prefix, cursor })
    for (const key of listed.keys) {
      const record = (await env.AUTH_KV.get(key.name, 'json')) as AccountOwnedRecord | null
      if (record?.account_id === accountId) names.push(key.name)
    }
    cursor = listed.list_complete ? undefined : listed.cursor
  } while (cursor)
  await Promise.all(names.map((name) => env.AUTH_KV.delete(name)))
}

export async function deleteRemoteStorage(env: Env, accountId: string): Promise<void> {
  await deleteR2Objects(env, accountId)
}

export async function deleteAccountMetadata(
  env: Env,
  accountId: string,
  email?: string
): Promise<void> {
  if (email) {
    const emailKey = `email:${email}`
    const emailRecord = (await env.AUTH_KV.get(emailKey, 'json')) as AccountOwnedRecord | null
    if (emailRecord?.account_id === accountId) await env.AUTH_KV.delete(emailKey)
  }

  await Promise.all([
    env.AUTH_KV.delete(`account:${accountId}`),
    env.AUTH_KV.delete(`escrow:${accountId}`),
    env.AUTH_KV.delete(`recovery:${accountId}`),
    env.AUTH_KV.delete(`devices:${accountId}`),
    deleteMatchingKvRecords(env, 'family:', accountId),
    deleteMatchingKvRecords(env, 'refresh:', accountId),
    deleteMatchingKvRecords(env, 'pair:', accountId),
  ])
}
