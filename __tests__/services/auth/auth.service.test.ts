import {
  register,
  loginNewDevice,
  recoverAccount,
  changePassword,
  getRecoveryStatus,
  addRecoveryPhrase,
  hydrateAuth,
  logout,
  canReturnToAccountFromDeletion,
  deleteAccount,
  returnToAccountFromDeletion,
} from '@/services/auth/auth.service'
import { wrapMasterKey } from '@/services/auth/crypto'
import { generateRecoveryPhrase, recoveryKeyFromPhrase } from '@/services/auth/recovery'
import { saveTokens, getTokens, clearTokens } from '@/services/auth/token-store'
import { deleteDatabase, beginWipe, endWipe } from '@/services/storage/db'
import { resetSessionStores } from '@/services/auth/session-reset'
import { cleanupNotifications } from '@/services/notifications/cleanup'
import { resumeNotificationReconciliation, suspendNotificationReconciliation, waitForNotificationReconciliation } from '@/services/notifications/orchestrator'
import {
  setWipePending,
  clearWipePending,
  repairInterruptedWipe,
} from '@/services/auth/wipe-marker'
import {
  clearAccountDeletionState,
  getAccountDeletionState,
  markAccountDeletionComplete,
  setAccountDeletionPending,
} from '@/services/auth/account-deletion-marker'
import { CryptoModule } from '@/native/CryptoModule'
import { useAuthStore } from '@/store/auth.store'
import { useSyncStore } from '@/store/sync.store'
import { ok } from '@/types/result'

jest.mock('expo-crypto', () => ({
  // Non-deterministic so generated recovery phrases differ between calls.
  getRandomBytesAsync: async (n: number) =>
    Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)),
}))
jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: {
    getKeyFromKeychain: jest.fn(),
    deriveKey: jest.fn(),
    setKeyInKeychain: jest.fn(),
    deleteKeyFromKeychain: jest.fn(),
    setKeyOwner: jest.fn(),
    getKeyOwner: jest.fn(),
    deleteKeyOwner: jest.fn(),
  },
}))
// Mock the storage module so importing auth.service doesn't pull in op-sqlite
// (native). logout() calls deleteDatabase()/beginWipe/endWipe.
jest.mock('@/services/storage/db', () => ({
  deleteDatabase: jest.fn(),
  beginWipe: jest.fn(),
  endWipe: jest.fn(),
}))
jest.mock('@/services/auth/token-store', () => ({
  saveTokens: jest.fn(),
  clearTokens: jest.fn(),
  getTokens: jest.fn(),
}))
// R2/R3: wipe-marker is a unit of its own (wipe-marker.test.ts); stub it here so
// auth.service tests can spy on whether the repair/wipe-markers were invoked.
jest.mock('@/services/auth/wipe-marker', () => ({
  setWipePending: jest.fn(),
  clearWipePending: jest.fn(),
  isWipePending: jest.fn(),
  repairInterruptedWipe: jest.fn(),
}))
jest.mock('@/services/auth/account-deletion-marker', () => ({
  clearAccountDeletionState: jest.fn(),
  getAccountDeletionState: jest.fn(),
  markAccountDeletionComplete: jest.fn(),
  setAccountDeletionPending: jest.fn(),
}))
// Session reset only needs to be invokable here; its behavior is unit-tested via
// the stores. Mocking avoids importing the store graph into the auth service.
jest.mock('@/services/auth/session-reset', () => ({
  resetSessionStores: jest.fn(),
}))
// Stable per-device id; mocked so register/login/logout send a known value.
jest.mock('@/services/auth/device-id', () => ({ getDeviceId: jest.fn(() => Promise.resolve('dev-1')) }))
jest.mock('@/services/notifications/cleanup', () => ({ cleanupNotifications: jest.fn() }))
jest.mock('@/services/notifications/orchestrator', () => ({
  resumeNotificationReconciliation: jest.fn(),
  suspendNotificationReconciliation: jest.fn(),
  waitForNotificationReconciliation: jest.fn(),
}))

const mockGetKey = CryptoModule.getKeyFromKeychain as jest.Mock
const mockDerive = CryptoModule.deriveKey as jest.Mock
const mockSetKey = CryptoModule.setKeyInKeychain as jest.Mock
const mockDeleteKey = CryptoModule.deleteKeyFromKeychain as jest.Mock
const mockSetKeyOwner = CryptoModule.setKeyOwner as jest.Mock
const mockDeleteKeyOwner = CryptoModule.deleteKeyOwner as jest.Mock
const mockSave = saveTokens as jest.Mock
const mockGetTokens = getTokens as jest.Mock
const mockClear = clearTokens as jest.Mock
const mockDeleteDb = deleteDatabase as jest.Mock
const mockBeginWipe = beginWipe as jest.Mock
const mockEndWipe = endWipe as jest.Mock
const mockSetWipePending = setWipePending as jest.Mock
const mockClearWipePending = clearWipePending as jest.Mock
const mockRepairWipe = repairInterruptedWipe as jest.Mock
const mockGetDeletionState = getAccountDeletionState as jest.Mock
const mockSetDeletionPending = setAccountDeletionPending as jest.Mock
const mockMarkDeletionComplete = markAccountDeletionComplete as jest.Mock
const mockClearDeletionState = clearAccountDeletionState as jest.Mock
const mockResetSession = resetSessionStores as jest.Mock
const mockCleanupNotifications = cleanupNotifications as jest.Mock
const mockResumeNotifications = resumeNotificationReconciliation as jest.Mock
const mockSuspendNotifications = suspendNotificationReconciliation as jest.Mock
const mockWaitForNotifications = waitForNotificationReconciliation as jest.Mock

const MASTER = 'ab'.repeat(32)
const WRAP = 'cd'.repeat(32)
const resp = (status: number, body: unknown = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})

beforeEach(() => {
  jest.clearAllMocks()
  useAuthStore.setState({ status: 'loading', accountId: null })
  useSyncStore.setState({ restoring: false })
  global.fetch = jest.fn()
  mockGetKey.mockResolvedValue(MASTER)
  mockDerive.mockResolvedValue(WRAP)
  mockCleanupNotifications.mockResolvedValue(ok(undefined))
  mockWaitForNotifications.mockResolvedValue(undefined)
  mockGetDeletionState.mockResolvedValue(null)
})

describe('register', () => {
  it('escrows the master key and authenticates on success', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, { account_id: 'acc1', access_token: 'at', refresh_token: 'rt' })
    )
    const res = await register('a@b.com', 'password')

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.accountId).toBe('acc1')
    expect(res.data.recoveryPhrase.split(' ')).toHaveLength(12) // shown once for the user to save
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.email).toBe('a@b.com')
    expect(body.password_hash).toBe('5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8')
    expect(body.key_escrow.encrypted_key).toBeTruthy()
    expect(body.key_escrow.salt).toBeTruthy()
    expect(body.recovery_hash).toMatch(/^[0-9a-f]{64}$/) // second escrow credential
    expect(body.recovery_escrow.encrypted_key).toBeTruthy()
    expect(body.device_label).toBe('Test Model') // hardware model, not the user-editable device name
    expect(body.platform).toBeTruthy()
    expect(body.device_id).toBe('dev-1') // stable id so logout can remove this exact row
    expect(mockSave).toHaveBeenCalledWith({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    // auth state is deferred until the user acknowledges the recovery phrase
    expect(useAuthStore.getState().status).not.toBe('authenticated')
  })

  it('returns a friendly EMAIL_TAKEN error when the email is already registered (409)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(409))
    const res = await register('a@b.com', 'password')
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error.code).toBe('EMAIL_TAKEN')
    expect(res.error.message).toMatch(/already exists/i)
  })

  it('fails on a generic server error', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(500))
    const res = await register('a@b.com', 'password')
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error.code).toBe('REGISTER_FAILED')
  })
})

describe('loginNewDevice', () => {
  it('recovers the master key from escrow and installs it', async () => {
    const escrow = await wrapMasterKey(MASTER, WRAP)
    if (!escrow.success) throw new Error('setup wrap failed')
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, {
        account_id: 'acc1',
        access_token: 'at',
        refresh_token: 'rt',
        key_escrow: { encrypted_key: escrow.data, salt: '00' },
      })
    )

    const res = await loginNewDevice('a@b.com', 'password')

    expect(res).toEqual({ success: true, data: { accountId: 'acc1' } })
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.device_label).toBe('Test Model') // hardware model, not the user-editable device name
    expect(body.platform).toBeTruthy()
    expect(body.device_id).toBe('dev-1')
    expect(mockDerive).toHaveBeenCalledWith('password', '00')
    expect(mockSetKey).toHaveBeenCalledWith(MASTER) // account key installed
    expect(mockSetKeyOwner).toHaveBeenCalledWith('acc1') // R3: ownership recorded
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useSyncStore.getState().restoring).toBe(true) // banner shows while the first pull lands
  })

  it('fails with the wrong password (escrow cannot be unwrapped)', async () => {
    const escrow = await wrapMasterKey(MASTER, WRAP)
    if (!escrow.success) throw new Error('setup wrap failed')
    mockDerive.mockResolvedValueOnce('ee'.repeat(32)) // wrong wrapping key
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, {
        account_id: 'acc1',
        access_token: 'at',
        refresh_token: 'rt',
        key_escrow: { encrypted_key: escrow.data, salt: '00' },
      })
    )

    const res = await loginNewDevice('a@b.com', 'wrong')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('LOGIN_DECRYPT_FAILED')
    expect(mockSetKey).not.toHaveBeenCalled()
  })

  it('maps a 401 to a friendly "wrong email or password" message', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(401, 'Invalid credentials'))

    const res = await loginNewDevice('a@b.com', 'wrong')
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.code).toBe('LOGIN_INVALID_CREDENTIALS')
      expect(res.error.message).toBe('Wrong email or password')
    }
    expect(mockSetKey).not.toHaveBeenCalled()
  })
})

describe('recoverAccount', () => {
  it('unwraps the recovery escrow with the phrase and installs the master key', async () => {
    const phrase = await generateRecoveryPhrase()
    const escrow = await wrapMasterKey(MASTER, recoveryKeyFromPhrase(phrase))
    if (!escrow.success) throw new Error('setup wrap failed')
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, {
        account_id: 'acc1',
        access_token: 'at',
        refresh_token: 'rt',
        recovery_escrow: { encrypted_key: escrow.data },
      })
    )

    const res = await recoverAccount('a@b.com', phrase)

    expect(res).toEqual({ success: true, data: { accountId: 'acc1' } })
    expect(mockSetKey).toHaveBeenCalledWith(MASTER)
    expect(mockSetKeyOwner).toHaveBeenCalledWith('acc1') // R3: ownership recorded
    expect(mockSave).toHaveBeenCalledWith({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    // recovery is a wizard — auth is flipped by the hook only after changePassword
    expect(useAuthStore.getState().status).not.toBe('authenticated')
  })

  it('rejects an invalid phrase without hitting the server', async () => {
    const res = await recoverAccount('a@b.com', 'these words are not a valid bip39 phrase ok')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('RECOVER_INVALID_PHRASE')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fails to decrypt with the wrong (but valid) phrase', async () => {
    const phrase = await generateRecoveryPhrase()
    let other = await generateRecoveryPhrase()
    while (other === phrase) other = await generateRecoveryPhrase()
    const escrow = await wrapMasterKey(MASTER, recoveryKeyFromPhrase(phrase))
    if (!escrow.success) throw new Error('setup wrap failed')
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, {
        account_id: 'acc1',
        access_token: 'at',
        refresh_token: 'rt',
        recovery_escrow: { encrypted_key: escrow.data },
      })
    )

    const res = await recoverAccount('a@b.com', other)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('RECOVER_DECRYPT_FAILED')
    expect(mockSetKey).not.toHaveBeenCalled()
  })
})

describe('changePassword', () => {
  it('re-wraps the escrow under the new password and updates the server', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(204))

    const res = await changePassword('newpassword')

    expect(res).toEqual({ success: true, data: true })
    const [path, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(path).toContain('/auth/change-password')
    const body = JSON.parse(init.body)
    expect(body.password_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.key_escrow.encrypted_key).toBeTruthy()
    expect(body.key_escrow.salt).toBeTruthy()
  })

  it('fails when the server rejects', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(400))
    const res = await changePassword('newpassword')
    expect(res.success).toBe(false)
  })
})

describe('getRecoveryStatus', () => {
  beforeEach(() => mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' }))

  it('reports configured=false for accounts without recovery', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(200, { configured: false }))
    const res = await getRecoveryStatus()
    expect(res).toEqual({ success: true, data: false })
  })

  it('reports configured=true once recovery exists', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(200, { configured: true }))
    const res = await getRecoveryStatus()
    expect(res).toEqual({ success: true, data: true })
  })
})

describe('addRecoveryPhrase', () => {
  it('wraps the master key under a new phrase and uploads it', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(204))

    const res = await addRecoveryPhrase()

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.recoveryPhrase.split(' ')).toHaveLength(12)
    const [path, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(path).toContain('/auth/recovery')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.recovery_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.recovery_escrow.encrypted_key).toBeTruthy()
  })

  it('fails when the server rejects', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(400))
    const res = await addRecoveryPhrase()
    expect(res.success).toBe(false)
  })
})

describe('hydrateAuth', () => {
  it('authenticates from stored tokens', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    await hydrateAuth()
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('falls back to unauthenticated when there is no session', async () => {
    mockGetTokens.mockResolvedValue(null)
    await hydrateAuth()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })
})

describe('deleteAccount', () => {
  it('deletes remotely before wiping local DB, key, and tokens', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(204))
    const calls: string[] = []
    ;(global.fetch as jest.Mock)
      .mockImplementationOnce(async () => {
        calls.push('readiness')
        return resp(204)
      })
      .mockImplementationOnce(async () => {
        calls.push('remote_delete')
        return resp(204)
      })
    mockDeleteDb.mockImplementation(() => calls.push('delete_db'))
    mockDeleteKey.mockImplementation(async () => { calls.push('delete_key') })
    mockClear.mockImplementation(async () => { calls.push('clear_tokens') })

    const result = await deleteAccount()

    expect(result).toEqual({ success: true, data: true })
    expect(calls.indexOf('remote_delete')).toBeLessThan(calls.indexOf('delete_db'))
    expect(calls).toEqual(expect.arrayContaining(['remote_delete', 'delete_db', 'delete_key', 'clear_tokens']))
    expect(mockSetDeletionPending).toHaveBeenCalledWith('acc1')
    expect(mockMarkDeletionComplete).toHaveBeenCalledWith('acc1')
    expect(mockClearDeletionState).toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })

  it('keeps the account usable when the readiness check cannot reach the server', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('offline'))

    const result = await deleteAccount()

    expect(result.success).toBe(false)
    expect(mockSetDeletionPending).not.toHaveBeenCalled()
    expect(mockDeleteDb).not.toHaveBeenCalled()
    expect(mockDeleteKey).not.toHaveBeenCalled()
    expect(mockClear).not.toHaveBeenCalled()
    expect(mockSuspendNotifications).not.toHaveBeenCalled()
    expect(mockResumeNotifications).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('preserves local state and keeps the deletion gate when deletion fails after readiness', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(resp(204))
      .mockRejectedValueOnce(new Error('connection lost'))

    const result = await deleteAccount()

    expect(result.success).toBe(false)
    expect(mockSetDeletionPending).toHaveBeenCalledWith('acc1')
    expect(mockDeleteDb).not.toHaveBeenCalled()
    expect(mockDeleteKey).not.toHaveBeenCalled()
    expect(mockClear).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ status: 'deleting', accountId: 'acc1' })
  })

  it('waits for an explicit choice instead of retrying pending deletion at launch', async () => {
    mockGetDeletionState.mockResolvedValue({ accountId: 'acc1', remoteComplete: false })

    await hydrateAuth()

    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockDeleteDb).not.toHaveBeenCalled()
    expect(mockDeleteKey).not.toHaveBeenCalled()
    expect(mockClear).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ status: 'deleting', accountId: 'acc1' })
  })

  it('finishes the local wipe at launch after remote deletion completed', async () => {
    mockGetDeletionState.mockResolvedValue({ accountId: 'acc1', remoteComplete: true })

    await hydrateAuth()

    expect(mockDeleteDb).toHaveBeenCalled()
    expect(mockDeleteKey).toHaveBeenCalled()
    expect(mockClear).toHaveBeenCalled()
    expect(mockClearDeletionState).toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })
})

describe('canReturnToAccountFromDeletion', () => {
  beforeEach(() => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
  })

  it.each([204, 404])('allows return when readiness responds %i', async (status) => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(status))

    await expect(canReturnToAccountFromDeletion()).resolves.toEqual({ success: true, data: true })
  })

  it('disallows return when remote deletion has started', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(409))

    await expect(canReturnToAccountFromDeletion()).resolves.toEqual({ success: true, data: false })
  })

  it('does not allow return when status is unavailable', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('offline'))

    const result = await canReturnToAccountFromDeletion()
    expect(result.success).toBe(false)
  })
})

describe('returnToAccountFromDeletion', () => {
  it('clears a stale local marker and restores the account when deletion never started remotely', async () => {
    useAuthStore.setState({ status: 'deleting', accountId: 'acc1' })
    mockGetDeletionState.mockResolvedValue({ accountId: 'acc1', remoteComplete: false })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(204))

    const result = await returnToAccountFromDeletion()

    expect(result).toEqual({ success: true, data: true })
    expect(mockClearDeletionState).toHaveBeenCalled()
    expect(mockResumeNotifications).toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('restores the account when the undeployed server has no deletion endpoint', async () => {
    useAuthStore.setState({ status: 'deleting', accountId: 'acc1' })
    mockGetDeletionState.mockResolvedValue({ accountId: 'acc1', remoteComplete: false })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(404))

    const result = await returnToAccountFromDeletion()

    expect(result).toEqual({ success: true, data: true })
    expect(mockClearDeletionState).toHaveBeenCalled()
    expect(mockResumeNotifications).toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('stays locked when remote deletion already started', async () => {
    useAuthStore.setState({ status: 'deleting', accountId: 'acc1' })
    mockGetDeletionState.mockResolvedValue({ accountId: 'acc1', remoteComplete: false })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(409))

    const result = await returnToAccountFromDeletion()

    expect(result.success).toBe(false)
    expect(mockClearDeletionState).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('deleting')
  })

  it('stays locked when deletion status cannot be confirmed', async () => {
    useAuthStore.setState({ status: 'deleting', accountId: 'acc1' })
    mockGetDeletionState.mockResolvedValue({ accountId: 'acc1', remoteComplete: false })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('offline'))

    const result = await returnToAccountFromDeletion()

    expect(result.success).toBe(false)
    expect(mockClearDeletionState).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('deleting')
  })
})

describe('logout', () => {
  it('wipes local state in R1 order: DB + key before tokens, then stores reset', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(204))

    const calls: string[] = []
    mockSetWipePending.mockImplementation(() => {
      calls.push('wipe_pending')
      return Promise.resolve()
    })
    mockSuspendNotifications.mockImplementation(() => calls.push('suspend_notifications'))
    mockBeginWipe.mockImplementation(() => calls.push('begin_wipe'))
    mockWaitForNotifications.mockImplementation(() => {
      calls.push('wait_notifications')
      return Promise.resolve()
    })
    mockCleanupNotifications.mockImplementation(() => {
      calls.push('cleanup_notifications')
      return Promise.resolve(ok(undefined))
    })
    mockDeleteDb.mockImplementation(() => calls.push('delete_db'))
    mockDeleteKey.mockImplementation(() => {
      calls.push('delete_key')
      return Promise.resolve()
    })
    mockDeleteKeyOwner.mockImplementation(() => {
      calls.push('delete_owner')
      return Promise.resolve()
    })
    mockClear.mockImplementation(() => {
      calls.push('clear_tokens')
      return Promise.resolve()
    })
    mockClearWipePending.mockImplementation(() => {
      calls.push('clear_wipe_pending')
      return Promise.resolve()
    })
    mockEndWipe.mockImplementation(() => calls.push('end_wipe'))
    mockResetSession.mockImplementation(() => calls.push('reset_stores'))

    await logout()

    // Best-effort: removes this device from the owner's paired-devices list.
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/\/auth\/logout$/)
    expect(init.body).toBeUndefined()

    // R1 load-bearing ordering: wipe marker + begin are first; DB + key die
    // BEFORE tokens; marker cleared + wipe ended only after the wipe; store
    // reset + unauth is last.
    expect(calls).toEqual([
      'wipe_pending',
      'suspend_notifications',
      'begin_wipe',
      'wait_notifications',
      'cleanup_notifications',
      'delete_db',
      'delete_key',
      'delete_owner',
      'clear_tokens',
      'clear_wipe_pending',
      'end_wipe',
      'reset_stores',
    ])
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })

  it('still completes the wipe when notification cleanup rejects', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockCleanupNotifications.mockRejectedValueOnce(new Error('native failure'))

    await logout()

    expect(mockDeleteDb).toHaveBeenCalled()
    expect(mockClear).toHaveBeenCalled()
    expect(mockClearWipePending).toHaveBeenCalled()
    expect(mockEndWipe).toHaveBeenCalled()
    expect(mockResetSession).toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })

  it('retains wipe marker and ends wipe guard when destructive cleanup fails', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockDeleteKey.mockRejectedValueOnce(new Error('keychain failure'))

    await expect(logout()).rejects.toThrow('keychain failure')

    expect(mockClearWipePending).not.toHaveBeenCalled()
    expect(mockEndWipe).toHaveBeenCalled()
    expect(mockResetSession).toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })

  it('still wipes local state when the server logout call fails (offline)', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('offline'))

    await logout()

    expect(mockClear).toHaveBeenCalled()
    expect(mockDeleteKey).toHaveBeenCalled()
    expect(mockDeleteKeyOwner).toHaveBeenCalled()
    expect(mockClearWipePending).toHaveBeenCalled()
    expect(mockEndWipe).toHaveBeenCalled()
    expect(mockResetSession).toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })
})

describe('register (account isolation, R3)', () => {
  it('preserves local residue when registration is rejected', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(409))
    await register('a@b.com', 'password')

    expect(mockRepairWipe).toHaveBeenCalled()
    expect(mockDeleteDb).not.toHaveBeenCalled()
    expect(mockDeleteKey).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('wipes old local residue and installs fresh key only after acceptance', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, { account_id: 'acc1', access_token: 'at', refresh_token: 'rt' })
    )
    await register('a@b.com', 'password')

    expect(mockDeleteDb).toHaveBeenCalled()
    expect(mockDeleteKey).toHaveBeenCalled()
    expect(mockDeleteKeyOwner).toHaveBeenCalled()
    expect(mockSetKey).toHaveBeenCalledWith(expect.any(String))
    expect(mockSetKeyOwner).toHaveBeenCalledWith('acc1')
    expect(mockSave).toHaveBeenCalledWith({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
  })
})

describe('hydrateAuth (R2)', () => {
  it('repairs an interrupted wipe before resolving the session', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    await hydrateAuth()
    expect(mockRepairWipe).toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })
})
