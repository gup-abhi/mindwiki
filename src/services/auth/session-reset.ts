import { useChatStore } from '@/store/chat.store'
import { useEntryStore } from '@/store/entry.store'
import { useLockStore } from '@/store/lock.store'
import { useSyncStore } from '@/store/sync.store'
import { useWikiStore } from '@/store/wiki.store'

/**
 * Reset all in-memory (session-owned) stores to their initial state. Called on
 * both logout (which also wipes disk) and session expiry (which keeps disk),
 * from one place so the two paths can't drift (R1 step 8 / R5, cases 12).
 * Does NOT reset the lock `enabled` preference — only its transient fields.
 */
export function resetSessionStores(): void {
  useEntryStore.getState().reset()
  useChatStore.getState().reset()
  useSyncStore.getState().reset()
  useWikiStore.getState().reset()
  useLockStore.getState().resetTransient()
}
