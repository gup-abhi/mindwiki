import { open } from '@op-engineering/op-sqlite'

import { initDb, getDb, closeDb, deleteDatabase } from '@/services/storage/db'

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }))

const mockOpen = open as jest.Mock

describe('storage/db', () => {
  let execute: jest.Mock
  let close: jest.Mock
  let del: jest.Mock

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({ rows: [], rowsAffected: 0 })
    close = jest.fn()
    del = jest.fn()
    mockOpen.mockReset()
    mockOpen.mockReturnValue({ execute, transaction: jest.fn(), close, delete: del })
    closeDb()
  })

  it('opens with the db name + encryption key and applies connection PRAGMAs', async () => {
    const result = await initDb('test-key')

    expect(result.success).toBe(true)
    expect(mockOpen).toHaveBeenCalledWith({ name: 'mindwiki.db', encryptionKey: 'test-key' })
    expect(execute).toHaveBeenCalledWith('PRAGMA journal_mode = WAL')
    expect(execute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })

  it('getDb throws before init and returns the instance after', async () => {
    expect(() => getDb()).toThrow(/not initialized/)
    await initDb('test-key')
    expect(getDb()).toBeDefined()
  })

  it('returns a DB_INIT_FAILED error when open throws', async () => {
    mockOpen.mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await initDb('test-key')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('DB_INIT_FAILED')
    }
  })

  it('closes the lazily-opened handle when the key is wrong (no leak)', async () => {
    // op-sqlite open() is lazy; a wrong key surfaces on the first PRAGMA, not open.
    execute.mockRejectedValueOnce(new Error('file is not a database'))

    const result = await initDb('wrong-key')

    expect(result.success).toBe(false)
    expect(close).toHaveBeenCalled() // the failed handle is closed, not leaked
  })

  it('deleteDatabase removes the file via the live handle and drops the singleton', async () => {
    await initDb('test-key')
    deleteDatabase()

    expect(del).toHaveBeenCalled()
    expect(() => getDb()).toThrow(/not initialized/) // singleton dropped
  })

  it('deleteDatabase still deletes the file with no live instance (post JS reload)', async () => {
    // Simulate a dev reload: module state reset, dbInstance is null but the file
    // is still on disk. The wipe must open a throwaway handle and delete it.
    closeDb() // dbInstance = null
    mockOpen.mockClear()

    deleteDatabase()

    // Opened a throwaway handle by NAME ONLY (no key needed to unlink) and deleted.
    expect(mockOpen).toHaveBeenCalledWith({ name: 'mindwiki.db' })
    expect(del).toHaveBeenCalled()
  })
})
