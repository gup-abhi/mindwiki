import { useAuthStore } from '@/store/auth.store'

describe('auth.store', () => {
  beforeEach(() => useAuthStore.setState({ status: 'loading', accountId: null }))

  it('starts in loading until launch hydration resolves', () => {
    expect(useAuthStore.getState().status).toBe('loading')
    expect(useAuthStore.getState().accountId).toBeNull()
  })

  it('setAuthenticated records the account id and defaults isNewAccount to false', () => {
    useAuthStore.getState().setAuthenticated('acc1')
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      accountId: 'acc1',
      isNewAccount: false,
    })
  })

  it('setAuthenticated flags a brand-new account when told', () => {
    useAuthStore.getState().setAuthenticated('acc1', true)
    expect(useAuthStore.getState().isNewAccount).toBe(true)
  })

  it('setDeleting locks the app to the account being removed', () => {
    useAuthStore.getState().setDeleting('acc1')
    expect(useAuthStore.getState()).toMatchObject({
      status: 'deleting',
      accountId: 'acc1',
      isNewAccount: false,
    })
  })

  it('setUnauthenticated clears the account and the new-account flag', () => {
    useAuthStore.getState().setAuthenticated('acc1', true)
    useAuthStore.getState().setUnauthenticated()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      accountId: null,
      isNewAccount: false,
    })
  })
})
