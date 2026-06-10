import { useLockStore, LOCK_GRACE_MS } from '@/store/lock.store'

const reset = () => useLockStore.setState({ locked: false, enabled: true, backgroundedAt: null })

describe('lock store', () => {
  beforeEach(reset)
  afterEach(() => jest.restoreAllMocks())

  it('requireUnlock locks when enabled but not when disabled', () => {
    useLockStore.getState().requireUnlock()
    expect(useLockStore.getState().locked).toBe(true)

    reset()
    useLockStore.getState().setEnabled(false)
    useLockStore.getState().requireUnlock()
    expect(useLockStore.getState().locked).toBe(false)
  })

  it('re-locks on foreground after the grace period', () => {
    const now = 1_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    useLockStore.getState().onBackground()
    jest.spyOn(Date, 'now').mockReturnValue(now + LOCK_GRACE_MS + 1)
    useLockStore.getState().onForeground()
    expect(useLockStore.getState().locked).toBe(true)
  })

  it('does not re-lock on foreground within the grace period', () => {
    const now = 1_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    useLockStore.getState().onBackground()
    jest.spyOn(Date, 'now').mockReturnValue(now + 5_000)
    useLockStore.getState().onForeground()
    expect(useLockStore.getState().locked).toBe(false)
  })

  it('unlock clears the lock and the background timestamp', () => {
    useLockStore.getState().requireUnlock()
    useLockStore.getState().onBackground()
    useLockStore.getState().unlock()
    expect(useLockStore.getState().locked).toBe(false)
    expect(useLockStore.getState().backgroundedAt).toBeNull()
  })

  it('disabling the lock clears an active lock', () => {
    useLockStore.getState().requireUnlock()
    expect(useLockStore.getState().locked).toBe(true)
    useLockStore.getState().setEnabled(false)
    expect(useLockStore.getState().locked).toBe(false)
  })
})
