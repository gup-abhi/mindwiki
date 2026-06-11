import { renderHook, waitFor } from '@testing-library/react-native'

import { useWikiPages, useWikiPage } from '@/hooks/useWiki'
import { listPages, getPage, deleteEmptyPages } from '@/services/storage/wiki'
import { ok } from '@/types/result'

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/storage/wiki', () => ({
  listPages: jest.fn(),
  getPage: jest.fn(),
  deleteEmptyPages: jest.fn(),
}))

const mockList = listPages as jest.Mock
const mockGet = getPage as jest.Mock
const mockDeleteEmpty = deleteEmptyPages as jest.Mock

describe('useWiki', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockGet.mockReset()
    mockDeleteEmpty.mockReset()
    mockDeleteEmpty.mockResolvedValue(ok(0))
  })

  it('useWikiPages loads pages on focus', async () => {
    mockList.mockResolvedValue(ok([{ id: 'p1', title: 'Anxiety' }]))
    const { result } = renderHook(() => useWikiPages())
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(result.current.pages[0].title).toBe('Anxiety')
  })

  it('useWikiPage loads a single page by id', async () => {
    mockGet.mockResolvedValue(ok({ id: 'p1', title: 'Anxiety', content: 'body' }))
    const { result } = renderHook(() => useWikiPage('p1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.page?.content).toBe('body')
  })

  it('useWikiPage is a no-op without an id', async () => {
    const { result } = renderHook(() => useWikiPage(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockGet).not.toHaveBeenCalled()
    expect(result.current.page).toBeNull()
  })
})
