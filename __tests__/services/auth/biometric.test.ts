import * as LocalAuthentication from 'expo-local-authentication'

import { authenticate, canAuthenticate, isLockEnabled, setLockEnabled } from '@/services/auth/biometric'

const mockAuth = LocalAuthentication.authenticateAsync as jest.Mock
const mockLevel = LocalAuthentication.getEnrolledLevelAsync as jest.Mock

describe('biometric', () => {
  beforeEach(() => jest.clearAllMocks())

  it('authenticate returns true on success, false on failure or throw', async () => {
    mockAuth.mockResolvedValueOnce({ success: true })
    expect(await authenticate('x')).toBe(true)
    mockAuth.mockResolvedValueOnce({ success: false })
    expect(await authenticate('x')).toBe(false)
    mockAuth.mockRejectedValueOnce(new Error('cancelled'))
    expect(await authenticate('x')).toBe(false)
  })

  it('canAuthenticate is false only when nothing is enrolled', async () => {
    mockLevel.mockResolvedValueOnce(0) // SecurityLevel.NONE
    expect(await canAuthenticate()).toBe(false)
    mockLevel.mockResolvedValueOnce(1) // SecurityLevel.SECRET (device PIN)
    expect(await canAuthenticate()).toBe(true)
  })

  it('lock preference defaults ON and round-trips', async () => {
    expect(await isLockEnabled()).toBe(true) // nothing stored -> default ON
    await setLockEnabled(false)
    expect(await isLockEnabled()).toBe(false)
    await setLockEnabled(true)
    expect(await isLockEnabled()).toBe(true)
  })
})
