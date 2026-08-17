export interface RuntimeStoreBridge {
  bumpSyncRevision: () => void
  notifySyncPending: () => void
  setSyncing: (syncing: boolean) => void
  beginSyncRestore: () => void
  endSyncRestore: () => void
  beginWikiWork: () => void
  endWikiWork: () => void
  setAuthenticated: (accountId: string, isNewAccount?: boolean) => void
  setRecoveryPending: (accountId: string) => void
  setDeleting: (accountId: string) => void
  setUnauthenticated: () => void
  getAccountId: () => string | null
  isNewAccount: () => boolean
}

const noop = (): void => undefined

let bridge: RuntimeStoreBridge = {
  bumpSyncRevision: noop,
  notifySyncPending: noop,
  setSyncing: noop,
  beginSyncRestore: noop,
  endSyncRestore: noop,
  beginWikiWork: noop,
  endWikiWork: noop,
  setAuthenticated: noop,
  setRecoveryPending: noop,
  setDeleting: noop,
  setUnauthenticated: noop,
  getAccountId: () => null,
  isNewAccount: () => false,
}

export function configureRuntimeStoreBridge(next: RuntimeStoreBridge): void {
  bridge = next
}

export function runtimeStoreBridge(): RuntimeStoreBridge {
  return bridge
}
