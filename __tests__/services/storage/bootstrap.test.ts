import { initStorage } from '@/services/storage/bootstrap'
import { CryptoModule } from '@/native/CryptoModule'
import { initDb } from '@/services/storage/db'
import { migrate } from '@/services/storage/migrations'
import { ok, err } from '@/types/result'

jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: { getKeyFromKeychain: jest.fn() },
}))
jest.mock('@/services/storage/db', () => ({ initDb: jest.fn() }))
jest.mock('@/services/storage/migrations', () => ({ migrate: jest.fn() }))

const mockGetKey = CryptoModule.getKeyFromKeychain as jest.Mock
const mockInitDb = initDb as jest.Mock
const mockMigrate = migrate as jest.Mock

describe('initStorage', () => {
  beforeEach(() => {
    mockGetKey.mockReset()
    mockInitDb.mockReset()
    mockMigrate.mockReset()
  })

  it('fetches the key, opens the db, and runs migrations', async () => {
    mockGetKey.mockResolvedValue('the-key')
    mockInitDb.mockResolvedValue(ok({}))
    mockMigrate.mockResolvedValue(ok([1]))

    const result = await initStorage()

    expect(result.success).toBe(true)
    expect(mockInitDb).toHaveBeenCalledWith('the-key')
    expect(mockMigrate).toHaveBeenCalled()
  })

  it('returns STORAGE_KEY_FAILED if the key cannot be obtained (db not opened)', async () => {
    mockGetKey.mockRejectedValue(new Error('keystore locked'))

    const result = await initStorage()

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('STORAGE_KEY_FAILED')
    expect(mockInitDb).not.toHaveBeenCalled()
  })

  it('propagates an initDb failure and does not migrate', async () => {
    mockGetKey.mockResolvedValue('k')
    mockInitDb.mockResolvedValue(err('DB_INIT_FAILED', 'nope'))

    const result = await initStorage()

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('DB_INIT_FAILED')
    expect(mockMigrate).not.toHaveBeenCalled()
  })

  it('propagates a migration failure', async () => {
    mockGetKey.mockResolvedValue('k')
    mockInitDb.mockResolvedValue(ok({}))
    mockMigrate.mockResolvedValue(err('MIGRATION_FAILED', 'bad'))

    const result = await initStorage()

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('MIGRATION_FAILED')
  })
})
