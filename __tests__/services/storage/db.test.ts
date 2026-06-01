import { open } from '@op-engineering/op-sqlite'

import { initDb, getDb, closeDb } from '@/services/storage/db'

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }))

const mockOpen = open as jest.Mock

describe('storage/db', () => {
  let execute: jest.Mock
  let close: jest.Mock

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({ rows: [], rowsAffected: 0 })
    close = jest.fn()
    mockOpen.mockReset()
    mockOpen.mockReturnValue({ execute, transaction: jest.fn(), close })
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
})
