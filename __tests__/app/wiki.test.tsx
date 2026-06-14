import { Alert } from 'react-native'
import { render, screen, fireEvent } from '@testing-library/react-native'

import WikiBrowse from '@/app/(tabs)/wiki/index'
import WikiCategoryScreen from '@/app/wiki/category/[category]'
import WikiPageScreen from '@/app/wiki/[id]'

const mockPush = jest.fn()
const mockBack = jest.fn()
let mockParams: Record<string, string> = { id: 'p1' }
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}))

const mockUseWikiPages = jest.fn()
const mockUseWikiPage = jest.fn()
const mockUseDismissedPages = jest.fn(() => ({
  pages: [] as Array<{ id: string; title: string; category: string }>,
  loading: false,
  refresh: jest.fn(),
}))
jest.mock('@/hooks/useWiki', () => ({
  useWikiPages: () => mockUseWikiPages(),
  useWikiPage: () => mockUseWikiPage(),
  useDismissedPages: () => mockUseDismissedPages(),
}))
const mockDismiss = jest.fn()
const mockRestore = jest.fn()
const mockCorrect = jest.fn()

const mixedPages = [
  { id: 'p1', title: 'Anxiety', category: 'emotion', entry_count: 3 },
  { id: 'p2', title: 'Joy', category: 'emotion', entry_count: 1 },
  { id: 'p3', title: 'Catastrophizing', category: 'distortion', entry_count: 2 },
  { id: 'p4', title: 'Work', category: 'theme', entry_count: 5 },
]

describe('WikiBrowse (category list)', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockParams = { id: 'p1' }
    mockUseDismissedPages.mockReturnValue({ pages: [], loading: false, refresh: jest.fn() })
  })

  it('shows the dropped-insights footer and opens it when pages were dropped', () => {
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    mockUseDismissedPages.mockReturnValue({
      pages: [{ id: 'd1', title: 'Avoidant', category: 'belief' }],
      loading: false,
      refresh: jest.fn(),
    })
    render(<WikiBrowse />)
    fireEvent.press(screen.getByText('Dropped insights'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/dismissed')
  })

  it('hides the dropped-insights footer when nothing is dropped', () => {
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    render(<WikiBrowse />)
    expect(screen.queryByText('Dropped insights')).toBeNull()
  })

  it('lists categories with page counts and opens one', () => {
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    render(<WikiBrowse />)
    expect(screen.getByText('Emotions')).toBeTruthy()
    expect(screen.getByText('2 pages')).toBeTruthy() // two emotion pages
    expect(screen.getByText('Distortions')).toBeTruthy()
    expect(screen.getByText('Themes')).toBeTruthy()
    fireEvent.press(screen.getByText('Emotions'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/category/emotion')
  })

  it('shows an empty state when there are no pages', () => {
    mockUseWikiPages.mockReturnValue({ pages: [], loading: false })
    render(<WikiBrowse />)
    expect(screen.getByText(/No pages yet/)).toBeTruthy()
  })
})

describe('WikiCategoryScreen', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockBack.mockReset()
  })

  it('lists only the pages in the category and opens one', () => {
    mockParams = { category: 'emotion' }
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    render(<WikiCategoryScreen />)
    expect(screen.getByText('Emotions')).toBeTruthy() // header label
    expect(screen.getByText('Anxiety')).toBeTruthy()
    expect(screen.getByText('Joy')).toBeTruthy()
    expect(screen.queryByText('Work')).toBeNull() // theme page excluded
    fireEvent.press(screen.getByText('Anxiety'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')
  })

  it('goes back to the wiki list', () => {
    mockParams = { category: 'theme' }
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    render(<WikiCategoryScreen />)
    fireEvent.press(screen.getByTestId('category-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})

describe('WikiPageScreen', () => {
  beforeEach(() => {
    mockParams = { id: 'p1' }
    mockDismiss.mockReset()
    mockRestore.mockReset()
    mockCorrect.mockReset()
  })

  const pageReturn = (page: Record<string, unknown>) => ({
    page,
    loading: false,
    dismiss: mockDismiss,
    restore: mockRestore,
    correct: mockCorrect,
  })

  it('renders the page title and synthesized content', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 2, entry_count: 3, content: 'You tend to expect the worst before meetings.', dismissed_at: null })
    )
    render(<WikiPageScreen />)
    expect(screen.getByText('Anxiety')).toBeTruthy()
    expect(screen.getByText('You tend to expect the worst before meetings.')).toBeTruthy()
    expect(screen.getByText('emotion · v2 · 3 entries')).toBeTruthy()
  })

  it('offers "This isn’t right" on an active page and confirms before dropping', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
      // tap the destructive "Drop it" button
      btns?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 1, entry_count: 3, content: 'c', dismissed_at: null })
    )
    render(<WikiPageScreen />)
    expect(screen.queryByTestId('wiki-dropped-banner')).toBeNull()
    fireEvent.press(screen.getByTestId('wiki-dismiss'))
    expect(spy).toHaveBeenCalled()
    expect(mockDismiss).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('shows the dropped banner and restores a dismissed page', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 1, entry_count: 3, content: 'c', dismissed_at: 123 })
    )
    render(<WikiPageScreen />)
    expect(screen.getByTestId('wiki-dropped-banner')).toBeTruthy()
    expect(screen.queryByTestId('wiki-dismiss')).toBeNull()
    fireEvent.press(screen.getByTestId('wiki-restore'))
    expect(mockRestore).toHaveBeenCalled()
  })

  it('rewrites a page in the user’s own words and saves the correction', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 1, entry_count: 3, content: 'AI take', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)
    fireEvent.press(screen.getByTestId('wiki-rewrite'))
    const input = screen.getByTestId('wiki-edit-input')
    fireEvent.changeText(input, 'What is actually true for me')
    fireEvent.press(screen.getByTestId('wiki-edit-save'))
    expect(mockCorrect).toHaveBeenCalledWith('What is actually true for me')
  })

  it('shows the “in your own words” badge on a corrected page', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 2, entry_count: 3, content: 'my words', dismissed_at: null, corrected_at: 123 })
    )
    render(<WikiPageScreen />)
    expect(screen.getByTestId('wiki-corrected-badge')).toBeTruthy()
  })

  it('shows version history when present', () => {
    mockUseWikiPage.mockReturnValue({
      page: {
        id: 'p1',
        title: 'Anxiety',
        category: 'emotion',
        version: 2,
        entry_count: 2,
        content: 'current',
        version_history: [{ version: 1, content: 'old', updated_at: 1700000000000 }],
      },
      loading: false,
    })
    render(<WikiPageScreen />)
    expect(screen.getByText('1 previous version')).toBeTruthy()
  })

  it('shows a not-found state', () => {
    mockUseWikiPage.mockReturnValue({ page: null, loading: false })
    render(<WikiPageScreen />)
    expect(screen.getByText('Page not found')).toBeTruthy()
  })
})
