import { useAuthStore } from '@/store/auth.store'

describe('auth.store', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accountId: null }))

  it('starts anonymous', () => {
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useAuthStore.getState().accountId).toBeNull()
  })

  it('setAuthenticated records the account id', () => {
    useAuthStore.getState().setAuthenticated('acc1')
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('setUnauthenticated clears the account but keeps journaling usable', () => {
    useAuthStore.getState().setAuthenticated('acc1')
    useAuthStore.getState().setUnauthenticated()
    expect(useAuthStore.getState()).toMatchObject({ status: 'unauthenticated', accountId: null })
  })

  it('setAnonymous resets', () => {
    useAuthStore.getState().setAuthenticated('acc1')
    useAuthStore.getState().setAnonymous()
    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', accountId: null })
  })
})
