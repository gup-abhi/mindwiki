import { act, renderHook } from '@testing-library/react-native'

import { useEntryLifecycle } from '@/hooks/useEntryLifecycle'
import { getEntry } from '@/services/storage/entries'
import { listContributions } from '@/services/storage/wiki-contributions'
import { areModelsReady } from '@/services/llm/model-manager'

jest.mock('@/services/storage/entries', () => ({ getEntry: jest.fn() }))
jest.mock('@/services/storage/wiki-contributions', () => ({ listContributions: jest.fn() }))
jest.mock('@/services/llm/model-manager', () => ({ areModelsReady: jest.fn() }))

const entry = (overrides = {}) => ({
  id: 'e1',
  situation: 'A difficult day',
  thought: '',
  wiki_indexed_at: null,
  ...overrides,
})

describe('useEntryLifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    ;(getEntry as jest.Mock).mockResolvedValue({ success: true, data: entry() })
    ;(listContributions as jest.Mock).mockResolvedValue({ success: true, data: [] })
    ;(areModelsReady as jest.Mock).mockResolvedValue(true)
  })

  afterEach(() => jest.useRealTimers())

  it('reports pending while a written entry has no contribution receipt', async () => {
    const { result } = renderHook(() => useEntryLifecycle('e1'))
    await act(async () => {})
    expect(result.current.status).toBe('pending')
  })

  it('reports ready only when a contribution receipt exists', async () => {
    ;(listContributions as jest.Mock).mockResolvedValue({ success: true, data: ['page-1'] })
    const { result } = renderHook(() => useEntryLifecycle('e1'))
    await act(async () => {})
    expect(result.current.status).toBe('ready')
  })

  it('reports unavailable when synthesis cannot run or the entry has no writing', async () => {
    ;(areModelsReady as jest.Mock).mockResolvedValue(false)
    const { result } = renderHook(() => useEntryLifecycle('e1'))
    await act(async () => {})
    expect(result.current.status).toBe('unavailable')
  })

  it('reports retryable when local evidence cannot be read', async () => {
    ;(getEntry as jest.Mock).mockResolvedValue({ success: false, error: { code: 'DB', message: 'read failed' } })
    const { result } = renderHook(() => useEntryLifecycle('e1'))
    await act(async () => {})
    expect(result.current.status).toBe('retryable')
  })
})
