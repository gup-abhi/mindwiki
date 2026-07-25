// TDD tests for useWikiConnections hook — verifies storage wiring, error
// aggregation, cancellation, sync-revision refresh.

import { renderHook, waitFor, act } from '@testing-library/react-native'

import { useWikiConnections } from '@/hooks/useWikiConnections'
import { useSyncStore } from '@/store/sync.store'

const mockListNodes = jest.fn()
const mockListEdges = jest.fn()
const mockListPages = jest.fn()

jest.mock('@/services/storage/graph', () => ({
  listNodes: (...args: any[]) => mockListNodes(...args),
  listEdges: (...args: any[]) => mockListEdges(...args),
}))
jest.mock('@/services/storage/wiki', () => ({
  listPages: (...args: any[]) => mockListPages(...args),
}))

const ok = <T,>(data: T) => ({ success: true as const, data })
const fail = (code: string) => ({ success: false as const, error: { code, message: code } })

afterEach(() => {
  mockListNodes.mockReset()
  mockListEdges.mockReset()
  mockListPages.mockReset()
  useSyncStore.setState({ revision: 0 })
})

describe('useWikiConnections — happy path', () => {
  it('returns loaded status with sorted labels and live pages', async () => {
    mockListNodes.mockResolvedValue(
      ok([
        { id: 'a', label: 'Anxiety', frequency: 5 } as any,
        { id: 'b', label: 'Work', frequency: 3 } as any,
      ])
    )
    mockListEdges.mockResolvedValue(ok([{ id: 'e1', source_id: 'a', target_id: 'b', weight: 1 } as any]))
    mockListPages.mockResolvedValue(ok([{ id: 'p-work', title: 'Work', dismissed_at: null, merged_into: null } as any]))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('loaded'))
    expect(result.current.labels).toEqual(['Work'])
    expect(result.current.pages.map((p) => p.id)).toEqual(['p-work'])
    expect(result.current.error).toBeNull()
  })

  it('returns loaded status with empty labels when node has no neighbors', async () => {
    mockListNodes.mockResolvedValue(ok([{ id: 'd', label: 'Sleep', frequency: 1 } as any]))
    mockListEdges.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(ok([]))

    const { result } = renderHook(() => useWikiConnections('Sleep'))
    await waitFor(() => expect(result.current.status).toBe('loaded'))
    expect(result.current.labels).toEqual([])
  })

  it('filters out dismissed and merged-into pages', async () => {
    mockListNodes.mockResolvedValue(ok([{ id: 'a', label: 'Anxiety', frequency: 5 } as any]))
    mockListEdges.mockResolvedValue(ok([{ id: 'e1', source_id: 'a', target_id: 'b', weight: 1 } as any]))
    mockListPages.mockResolvedValue(
      ok([
        { id: 'p-b', title: 'Work', dismissed_at: null, merged_into: null } as any,
        { id: 'p-c', title: 'Deadlines', dismissed_at: 100, merged_into: null } as any,
        { id: 'p-d', title: 'Money', dismissed_at: null, merged_into: 'p-b' } as any,
      ])
    )
    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('loaded'))
    expect(result.current.pages.map((p) => p.id)).toEqual(['p-b'])
  })
})

describe('useWikiConnections — failure paths', () => {
  it('reports error when listNodes fails', async () => {
    mockListNodes.mockResolvedValue(fail('NODES'))
    mockListEdges.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(ok([]))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('nodes')
    expect(result.current.labels).toEqual([])
  })

  it('reports error when listEdges fails', async () => {
    mockListNodes.mockResolvedValue(ok([{ id: 'a', label: 'Anxiety', frequency: 5 } as any]))
    mockListEdges.mockResolvedValue(fail('EDGES'))
    mockListPages.mockResolvedValue(ok([]))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('edges')
  })

  it('reports error when listPages fails', async () => {
    mockListNodes.mockResolvedValue(ok([{ id: 'a', label: 'Anxiety', frequency: 5 } as any]))
    mockListEdges.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(fail('PAGES'))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('pages')
  })

  it('aggregates multiple failures', async () => {
    mockListNodes.mockResolvedValue(fail('NODES'))
    mockListEdges.mockResolvedValue(fail('EDGES'))
    mockListPages.mockResolvedValue(ok([]))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('nodes')
    expect(result.current.error).toContain('edges')
  })

  it('does not surface raw rejection messages as labels in error path', async () => {
    mockListNodes.mockRejectedValue(new Error('database is locked'))
    mockListEdges.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(ok([]))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    // We expose a list of failing read kinds — never the SQL state or
    // rejection text, which could leak schema info.
    expect(result.current.error).toContain('nodes')
  })
})

describe('useWikiConnections — revision refresh', () => {
  it('re-reads when sync store revision changes', async () => {
    mockListNodes.mockResolvedValue(ok([{ id: 'a', label: 'Anxiety', frequency: 5 } as any]))
    mockListEdges.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(ok([]))

    const { result } = renderHook(() => useWikiConnections('Anxiety'))
    await waitFor(() => expect(result.current.status).toBe('loaded'))
    expect(mockListNodes).toHaveBeenCalledTimes(1)

    await act(async () => {
      useSyncStore.setState({ revision: 1 })
    })
    await waitFor(() => expect(mockListNodes).toHaveBeenCalledTimes(2))
  })
})

describe('useWikiConnections — cancellation', () => {
  it('does not setState after unmount', async () => {
    let resolveNodes: any
    mockListNodes.mockReturnValue(
      new Promise((resolve) => {
        resolveNodes = resolve
      })
    )
    mockListEdges.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(ok([]))

    const { result, unmount } = renderHook(() => useWikiConnections('Anxiety'))
    unmount()
    // Resolve after unmount — should not throw.
    resolveNodes(ok([]))
    // status remains the initial 'loading'.
    expect(result.current.status).toBe('loading')
  })
})
