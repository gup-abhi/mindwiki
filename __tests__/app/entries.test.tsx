import { fireEvent, render, screen } from '@testing-library/react-native'

import EntriesScreen from '@/app/entries/index'

const mockBack = jest.fn()
const mockPush = jest.fn()
const mockSetQuery = jest.fn()
const mockSetEmotion = jest.fn()
const mockLoadMore = jest.fn()
const mockRefresh = jest.fn()
const mockArchive = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}))
jest.mock('@/hooks/useEntries', () => ({
  useEntryArchive: () => mockArchive(),
}))

const entry = (id: string) => ({
  id,
  created_at: Date.now() - 24 * 60 * 60 * 1000,
  mood: 3,
  situation: `situation ${id}`,
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: 'Calm',
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  tagged_at: 1,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal' as const,
})

const state = (over = {}) => ({
  entries: [entry('e1')],
  query: '',
  emotion: null,
  loading: false,
  loadingMore: false,
  error: null,
  total: 1,
  emotions: ['Calm'],
  hasMore: true,
  setQuery: mockSetQuery,
  setEmotion: mockSetEmotion,
  loadMore: mockLoadMore,
  refresh: mockRefresh,
  ...over,
})

describe('Entries archive screen', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockPush.mockReset()
    mockSetQuery.mockReset()
    mockSetEmotion.mockReset()
    mockLoadMore.mockReset()
    mockRefresh.mockReset()
    mockArchive.mockReset()
    mockArchive.mockReturnValue(state())
  })

  it('renders search, filters, grouped entries, and navigation actions', () => {
    render(<EntriesScreen />)
    expect(screen.getByText('Entries')).toBeTruthy()
    expect(screen.getByText('Yesterday')).toBeTruthy()
    expect(screen.getByText('situation e1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('entries-search-toggle'))
    fireEvent.changeText(screen.getByTestId('entries-search'), 'meeting')
    expect(mockSetQuery).toHaveBeenCalledWith('meeting')
    fireEvent.press(screen.getByTestId('entries-filter-Calm'))
    expect(mockSetEmotion).toHaveBeenCalledWith('Calm')
    fireEvent.press(screen.getByTestId('entries-search-toggle'))
    expect(mockSetQuery).toHaveBeenCalledWith('')
    fireEvent.press(screen.getByTestId('entries-back'))
    expect(mockBack).toHaveBeenCalled()
  })

  it('routes every visible row, including entries after the first three', () => {
    mockArchive.mockReturnValue(state({
      entries: [entry('e1'), entry('e2'), entry('e3'), entry('e4')],
      total: 4,
    }))
    render(<EntriesScreen />)

    fireEvent.press(screen.getByText('situation e4'))

    expect(mockPush).toHaveBeenCalledWith('/entries/e4')
  })

  it('routes compose actions and loads more at list end', () => {
    render(<EntriesScreen />)
    fireEvent.press(screen.getByTestId('entries-new'))
    expect(mockPush).toHaveBeenCalledWith('/entry')
    const list = screen.UNSAFE_getByType(require('react-native').SectionList)
    fireEvent(list, 'onEndReached')
    expect(mockLoadMore).toHaveBeenCalled()
  })

  it('renders error retry and no-result clear states', () => {
    mockArchive.mockReturnValue(state({ entries: [], error: { code: 'FAIL', message: 'Could not load' } }))
    render(<EntriesScreen />)
    expect(screen.getByText('Couldn’t load entries')).toBeTruthy()
    fireEvent.press(screen.getByTestId('entries-retry'))
    expect(mockRefresh).toHaveBeenCalled()

    mockArchive.mockReturnValue(state({ entries: [], error: null, query: 'missing' }))
    render(<EntriesScreen />)
    expect(screen.getByText('No entries match your search')).toBeTruthy()
    fireEvent.press(screen.getByTestId('entries-clear'))
    expect(mockSetQuery).toHaveBeenCalledWith('')
    expect(mockSetEmotion).toHaveBeenCalledWith(null)
  })
})