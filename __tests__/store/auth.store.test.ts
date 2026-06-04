import { useAuthStore } from '@/store/auth.store'

describe('auth.store', () => {
  beforeEach(() => useAuthStore.setState({ status: 'loading', accountId: null }))

  it('starts in loading until launch hydration resolves', () => {
    expect(useAuthStore.getState().status).toBe('loading')
    expect(useAuthStore.getState().accountId).toBeNull()
  })

  it('setAuthenticated records the account id', () => {
    useAuthStore.getState().setAuthenticated('acc1')
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('setUnauthenticated clears the account', () => {
    useAuthStore.getState().setAuthenticated('acc1')
    useAuthStore.getState().setUnauthenticated()
    expect(useAuthStore.getState()).toMatchObject({ status: 'unauthenticated', accountId: null })
  })
})
