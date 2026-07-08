import { Alert } from 'react-native'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'

import YouScreen from '@/app/(tabs)/you'
import WikiCategoryScreen from '@/app/wiki/category/[category]'
import WikiPageScreen from '@/app/wiki/[id]'
import { type PageTrend } from '@/services/insights/page-trend'

const mockPush = jest.fn()
const mockBack = jest.fn()
let mockParams: Record<string, string> = { id: 'p1' }
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}))

jest.mock('@/hooks/useEntries', () => ({ useEntries: () => ({ entries: [] }) }))
jest.mock('@/hooks/useStreakFreezes', () => ({
  useStreakFreezes: () => ({ frozenDays: new Set<number>() }),
}))
jest.mock('@/hooks/useDigest', () => ({ useDigest: () => ({ digest: null, loading: true, synthesizing: false }) }))
jest.mock('@/services/storage/graph', () => ({ dismissNode: jest.fn() }))
jest.mock('@/store/wiki.store', () => ({ useWikiStore: () => ({ pending: 0 }) }))
jest.mock('@/hooks/useGraph', () => ({
  useGraph: () => ({ nodes: [], edges: [], refresh: jest.fn() }),
  useNodeContext: () => ({ context: null, loading: false }),
  useNodeDismissals: () => ({ dismissals: [], refresh: jest.fn() }),
}))
jest.mock('react-native-webview', () => ({
  default: () => null,
  WebView: () => null,
}))
const mockUseWikiPages = jest.fn()
const mockUseWikiPage = jest.fn()
const mockUseDismissedPages = jest.fn(() => ({
  pages: [] as Array<{ id: string; title: string; category: string }>,
  loading: false,
  refresh: jest.fn(),
}))
const mockUsePageTrend = jest.fn((): PageTrend | null => null)
jest.mock('@/hooks/useWiki', () => ({
  useWikiPages: () => mockUseWikiPages(),
  useWikiPage: () => mockUseWikiPage(),
  useDismissedPages: () => mockUseDismissedPages(),
  usePageTrend: () => mockUsePageTrend(),
  useTrendingPages: () => [],
}))

jest.mock('@/hooks/useMergeSuggestions', () => ({
  useMergeSuggestions: () => ({ pair: null, busy: false, confirm: jest.fn(), dismiss: jest.fn() }),
}))

const mockUseReframes = jest.fn(() => ({
  reframes: [] as Array<{ id: string; balanced_thought: string; created_at: number }>,
  refresh: jest.fn(),
  save: jest.fn(),
  suggest: jest.fn(),
}))
jest.mock('@/hooks/useReframes', () => ({
  useReframes: () => mockUseReframes(),
}))
const mockDismiss = jest.fn()
const mockRestore = jest.fn()
const mockCorrect = jest.fn()
const mockRegenerate = jest.fn()

const mixedPages = [
  { id: 'p1', title: 'Anxiety', category: 'emotion', entry_count: 3 },
  { id: 'p2', title: 'Joy', category: 'emotion', entry_count: 1 },
  { id: 'p3', title: 'Catastrophizing', category: 'distortion', entry_count: 2 },
  { id: 'p4', title: 'Work', category: 'theme', entry_count: 5 },
]

describe('WikiBrowse (category list, inside You tab > Pages segment)', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockParams = { id: 'p1' }
    mockUseDismissedPages.mockReturnValue({ pages: [], loading: false, refresh: jest.fn() })
  })

  function renderPages() {
    render(<YouScreen />)
  }

  it('shows the dropped-insights footer and opens it when pages were dropped', () => {
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    mockUseDismissedPages.mockReturnValue({
      pages: [{ id: 'd1', title: 'Avoidant', category: 'belief' }],
      loading: false,
      refresh: jest.fn(),
    })
    renderPages()
    fireEvent.press(screen.getByText('Dropped insights'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/dismissed')
  })

  it('hides the dropped-insights footer when nothing is dropped', () => {
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    renderPages()
    expect(screen.queryByText('Dropped insights')).toBeNull()
  })

  it('lists categories with page counts and opens one', () => {
    mockUseWikiPages.mockReturnValue({ pages: mixedPages, loading: false })
    renderPages()
    expect(screen.getByText('Emotions')).toBeTruthy()
    expect(screen.getByText('2 pages')).toBeTruthy() // two emotion pages
    expect(screen.getByText('Distortions')).toBeTruthy()
    expect(screen.getByText('Themes')).toBeTruthy()
    fireEvent.press(screen.getByText('Emotions'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/category/emotion')
  })

  it('shows an empty state when there are no pages', () => {
    mockUseWikiPages.mockReturnValue({ pages: [], loading: false })
    renderPages()
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
    mockRegenerate.mockReset().mockResolvedValue(null) // null = success
    mockUseReframes.mockReturnValue({ reframes: [], refresh: jest.fn(), save: jest.fn(), suggest: jest.fn() })
    mockUsePageTrend.mockReset().mockReturnValue(null) // no trend by default
  })

  const pageReturn = (page: Record<string, unknown>) => ({
    page,
    loading: false,
    dismiss: mockDismiss,
    restore: mockRestore,
    correct: mockCorrect,
    regenerate: mockRegenerate,
    regenerating: false,
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

  it('shows the "How this has changed" trend section only when the trend has a message', () => {
    const page = { id: 'p1', title: 'Anxiety', category: 'emotion', version: 2, entry_count: 6, content: 'c', dismissed_at: null }
    mockUseWikiPage.mockReturnValue(pageReturn(page))

    // No message → no section.
    const { rerender } = render(<WikiPageScreen />)
    expect(screen.queryByText('How this has changed')).toBeNull()
    expect(screen.queryByTestId('page-trend')).toBeNull()

    // With a message → section + sparkline render.
    mockUsePageTrend.mockReturnValue({
      totalEntries: 6,
      weeks: [{ weekStart: 0, count: 2, avgMood: 3 }],
      frequencyDirection: 'falling',
      moodDirection: 'steady',
      message: 'Anxiety has been coming up less often than it did a month ago.',
    })
    rerender(<WikiPageScreen />)
    expect(screen.getByText('How this has changed')).toBeTruthy()
    expect(screen.getByTestId('page-trend')).toBeTruthy()
    expect(
      screen.getByText('Anxiety has been coming up less often than it did a month ago.')
    ).toBeTruthy()
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

  it('regenerates the page in the current voice', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 1, entry_count: 3, content: 'c', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)
    fireEvent.press(screen.getByTestId('wiki-regenerate'))
    expect(mockRegenerate).toHaveBeenCalled()
  })

  it('alerts with the reason when regeneration fails', async () => {
    mockRegenerate.mockResolvedValue('Deep model inference failed')
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 1, entry_count: 3, content: 'c', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)
    fireEvent.press(screen.getByTestId('wiki-regenerate'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('Couldn’t regenerate', expect.any(String)))
    spy.mockRestore()
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
    expect(screen.getByText('Previous versions')).toBeTruthy()
  })

  it('shows a not-found state', () => {
    mockUseWikiPage.mockReturnValue({ page: null, loading: false })
    render(<WikiPageScreen />)
    expect(screen.getByText('Page not found')).toBeTruthy()
  })

  it('offers "Challenge this belief" on a belief page and opens the reframe flow', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p9', title: 'I am not good enough', category: 'belief', version: 1, entry_count: 2, content: 'c', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)
    fireEvent.press(screen.getByTestId('wiki-challenge-belief'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/reframe',
      params: { belief: 'I am not good enough' },
    })
  })

  it('does not offer the reframe flow on a non-belief page', () => {
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p1', title: 'Anxiety', category: 'emotion', version: 1, entry_count: 3, content: 'c', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)
    expect(screen.queryByTestId('wiki-challenge-belief')).toBeNull()
  })

  it('lists the user’s saved reframes on a belief page', () => {
    mockUseReframes.mockReturnValue({
      reframes: [{ id: 'r1', balanced_thought: 'I can be nervous and still capable.', created_at: 0 }],
      refresh: jest.fn(),
      save: jest.fn(),
      suggest: jest.fn(),
    })
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p9', title: 'I am not good enough', category: 'belief', version: 1, entry_count: 2, content: 'c', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)
    expect(screen.getByText('I can be nervous and still capable.')).toBeTruthy()
  })

  it('shows only the latest reframe, collapsing older ones behind a toggle', () => {
    mockUseReframes.mockReturnValue({
      reframes: [
        { id: 'r2', balanced_thought: 'Latest balanced thought.', created_at: 200 },
        { id: 'r1', balanced_thought: 'Older balanced thought.', created_at: 100 },
      ],
      refresh: jest.fn(),
      save: jest.fn(),
      suggest: jest.fn(),
    })
    mockUseWikiPage.mockReturnValue(
      pageReturn({ id: 'p9', title: 'I am not good enough', category: 'belief', version: 1, entry_count: 2, content: 'c', dismissed_at: null, corrected_at: null })
    )
    render(<WikiPageScreen />)

    // latest visible, older hidden behind "1 earlier reframe"
    expect(screen.getByText('Latest balanced thought.')).toBeTruthy()
    expect(screen.queryByText('Older balanced thought.')).toBeNull()
    expect(screen.getByText('1 earlier reframe')).toBeTruthy()

    fireEvent.press(screen.getByTestId('wiki-reframes-toggle'))
    expect(screen.getByText('Older balanced thought.')).toBeTruthy()
    expect(screen.getByText('Hide earlier reframes')).toBeTruthy()
  })
})
