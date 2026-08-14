import * as SecureStore from 'expo-secure-store'

import {
  clearRecoveryPending,
  getRecoveryPending,
  setRecoveryPending,
} from '@/services/auth/recovery-pending-marker'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}))

const mockGet = SecureStore.getItemAsync as jest.Mock
const mockSet = SecureStore.setItemAsync as jest.Mock
const mockDelete = SecureStore.deleteItemAsync as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('recovery pending marker', () => {
  it('stores only the account and phase in the device keystore', async () => {
    await setRecoveryPending({ accountId: 'acc1', phase: 'needs_phrase' })

    expect(mockSet).toHaveBeenCalledWith(
      'mindwiki.recovery_pending',
      JSON.stringify({ accountId: 'acc1', phase: 'needs_phrase' }),
      expect.anything()
    )
  })

  it('strictly parses valid markers and rejects malformed values', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({ accountId: 'acc1', phase: 'showing_phrase' }))
    await expect(getRecoveryPending()).resolves.toEqual({ accountId: 'acc1', phase: 'showing_phrase' })

    mockGet.mockResolvedValueOnce(JSON.stringify({ accountId: 'acc1', phase: 'showing_phrase', phrase: 'secret words' }))
    await expect(getRecoveryPending()).resolves.toBeNull()
  })

  it('rejects malformed phases and empty account ids', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({ accountId: '', phase: 'needs_phrase' }))
    await expect(getRecoveryPending()).resolves.toBeNull()
    mockGet.mockResolvedValueOnce(JSON.stringify({ accountId: 'acc1', phase: 'invalid' }))
    await expect(getRecoveryPending()).resolves.toBeNull()
  })

  it('clears the marker', async () => {
    await clearRecoveryPending()
    expect(mockDelete).toHaveBeenCalledWith('mindwiki.recovery_pending')
  })
})
