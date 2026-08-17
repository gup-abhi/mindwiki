import {
  configureRuntimeStoreBridge,
  runtimeStoreBridge,
  type RuntimeStoreBridge,
} from '@/services/runtime/store-bridge'

const bridge = (): RuntimeStoreBridge => ({
  bumpSyncRevision: jest.fn(),
  notifySyncPending: jest.fn(),
  setSyncing: jest.fn(),
  beginSyncRestore: jest.fn(),
  endSyncRestore: jest.fn(),
  beginWikiWork: jest.fn(),
  endWikiWork: jest.fn(),
  setAuthenticated: jest.fn(),
  setRecoveryPending: jest.fn(),
  setDeleting: jest.fn(),
  setUnauthenticated: jest.fn(),
  getAccountId: jest.fn(() => 'account-a'),
  isNewAccount: jest.fn(() => true),
})

describe('runtime store bridge', () => {
  afterEach(() => {
    jest.resetModules()
  })

  it('routes runtime projections through the configured bridge', () => {
    const configured = bridge()
    configureRuntimeStoreBridge(configured)

    expect(runtimeStoreBridge()).toBe(configured)
    runtimeStoreBridge().bumpSyncRevision()
    runtimeStoreBridge().setAuthenticated('account-b', false)
    expect(configured.bumpSyncRevision).toHaveBeenCalledTimes(1)
    expect(configured.setAuthenticated).toHaveBeenCalledWith('account-b', false)
  })

  it('starts with safe no-op projections before app wiring', () => {
    jest.resetModules()
    const fresh = require('@/services/runtime/store-bridge') as typeof import('@/services/runtime/store-bridge')
    expect(fresh.runtimeStoreBridge().getAccountId()).toBeNull()
    expect(fresh.runtimeStoreBridge().isNewAccount()).toBe(false)
    expect(() => fresh.runtimeStoreBridge().setUnauthenticated()).not.toThrow()
  })
})
