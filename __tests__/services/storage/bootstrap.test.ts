import { initStorage } from '@/services/storage/bootstrap'
import { CryptoModule } from '@/native/CryptoModule'
import { initDb } from '@/services/storage/db'
import { migrate } from '@/services/storage/migrations'
import { getSetting } from '@/services/storage/settings'
import { dedupeTopics } from '@/services/wiki/dedupe'
import { ok, err } from '@/types/result'

jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: { getKeyFromKeychain: jest.fn() },
}))
jest.mock('@/services/storage/db', () => ({ initDb: jest.fn() }))
jest.mock('@/services/storage/migrations', () => ({ migrate: jest.fn() }))
jest.mock('@/services/graph/engine', () => ({
  rebuildGraph: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
jest.mock('@/services/wiki/dedupe', () => ({
  dedupeTopics: jest.fn(() => Promise.resolve({ success: true, data: { entriesUpdated: 0, pagesMerged: 0 } })),
}))
jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(() => Promise.resolve({ success: true, data: '1' })), // dedupe already done by default
  setSetting: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))

const mockGetKey = CryptoModule.getKeyFromKeychain as jest.Mock
const mockInitDb = initDb as jest.Mock
const mockMigrate = migrate as jest.Mock
const mockGetSetting = getSetting as jest.Mock
const mockDedupe = dedupeTopics as jest.Mock

describe('initStorage', () => {
  beforeEach(() => {
    mockGetKey.mockReset()
    mockInitDb.mockReset()
    mockMigrate.mockReset()
    mockGetSetting.mockReset().mockResolvedValue(ok('1'))
    mockDedupe.mockClear().mockResolvedValue(ok({ entriesUpdated: 0, pagesMerged: 0 }))
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

  it('runs the one-time topic dedupe once, then sets the flag', async () => {
    mockGetKey.mockResolvedValue('the-key')
    mockInitDb.mockResolvedValue(ok({}))
    mockMigrate.mockResolvedValue(ok([13]))
    mockGetSetting.mockResolvedValue(ok(null)) // flag not yet set → should run

    await initStorage()

    expect(mockDedupe).toHaveBeenCalled()
  })

  it('skips the topic dedupe when the flag is already set', async () => {
    mockGetKey.mockResolvedValue('the-key')
    mockInitDb.mockResolvedValue(ok({}))
    mockMigrate.mockResolvedValue(ok([13]))
    mockGetSetting.mockResolvedValue(ok('1')) // already done

    await initStorage()

    expect(mockDedupe).not.toHaveBeenCalled()
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
