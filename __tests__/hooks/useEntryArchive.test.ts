import { act, renderHook, waitFor } from '@testing-library/react-native'

import { useEntryArchive } from '@/hooks/useEntries'
import { ok } from '@/types/result'

const mockPage = jest.fn()
const mockCount = jest.fn()
const mockEmotions = jest.fn()

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(() => callback(), [])
  },
}))
jest.mock('@/services/storage/entries', () => ({
  listEntries: jest.fn(),
  getEntry: jest.fn(),
  listJournalEntriesPage: (...args: unknown[]) => mockPage(...args),
  countJournalEntries: (...args: unknown[]) => mockCount(...args),
  listJournalEmotions: (...args: unknown[]) => mockEmotions(...args),
  getJournalEntryNeighbors: jest.fn(),
}))

const make = (id: string) => ({
  id,
  created_at: Number(id),
  mood: 3,
  situation: id,
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal' as const,
})

describe('useEntryArchive', () => {
  beforeEach(() => {
    jest.useRealTimers()
    mockPage.mockReset()
    mockCount.mockReset()
    mockEmotions.mockReset()
    mockCount.mockResolvedValue(ok(3))
    mockEmotions.mockResolvedValue(ok(['Joy']))
  })

  it('loads first page and archive metadata', async () => {
    mockPage.mockResolvedValue(ok({ items: [make('3'), make('2')], nextCursor: { createdAt: 2, id: '2' }, hasMore: true }))
    const { result } = renderHook(() => useEntryArchive())
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    expect(result.current.total).toBe(3)
    expect(result.current.emotions).toEqual(['Joy'])
    expect(result.current.hasMore).toBe(true)
  })

  it('appends next page once and ignores repeated load-more while pending', async () => {
    let resolveNext: ((value: ReturnType<typeof ok>) => void) | undefined
    mockPage
      .mockResolvedValueOnce(ok({ items: [make('3')], nextCursor: { createdAt: 3, id: '3' }, hasMore: true }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve }))
    const { result } = renderHook(() => useEntryArchive())
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })
    expect(mockPage).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveNext?.(ok({ items: [make('2'), make('3')], nextCursor: null, hasMore: false }))
    })
    expect(result.current.entries.map((entry) => entry.id)).toEqual(['3', '2'])
    expect(result.current.hasMore).toBe(false)
  })

  it('resets page after debounced query change', async () => {
    jest.useFakeTimers()
    mockPage
      .mockResolvedValueOnce(ok({ items: [make('3')], nextCursor: { createdAt: 3, id: '3' }, hasMore: true }))
      .mockResolvedValueOnce(ok({ items: [make('1')], nextCursor: null, hasMore: false }))
    const { result } = renderHook(() => useEntryArchive())
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    act(() => {
      result.current.setQuery('needle')
      jest.advanceTimersByTime(250)
    })
    await waitFor(() => expect(result.current.entries[0]?.id).toBe('1'))
    expect(mockPage.mock.calls[1][0]).toEqual(expect.objectContaining({ query: 'needle' }))
    expect(mockPage.mock.calls[1][0].cursor).toBeUndefined()
  })
})