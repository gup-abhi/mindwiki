import { useSyncStore } from '@/store/sync.store'

describe('sync.store', () => {
  beforeEach(() => {
    useSyncStore.setState({ syncing: false, restoring: false })
  })

  it('toggles the syncing flag', () => {
    useSyncStore.getState().setSyncing(true)
    expect(useSyncStore.getState().syncing).toBe(true)
    useSyncStore.getState().setSyncing(false)
    expect(useSyncStore.getState().syncing).toBe(false)
  })

  it('begins and ends a restore', () => {
    useSyncStore.getState().beginRestore()
    expect(useSyncStore.getState().restoring).toBe(true)
    useSyncStore.getState().endRestore()
    expect(useSyncStore.getState().restoring).toBe(false)
  })
})
