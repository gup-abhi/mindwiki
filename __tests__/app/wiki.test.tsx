import { render, screen, fireEvent } from '@testing-library/react-native'

import WikiBrowse from '@/app/(tabs)/wiki/index'
import WikiPageScreen from '@/app/wiki/[id]'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ id: 'p1' }),
}))

const mockUseWikiPages = jest.fn()
const mockUseWikiPage = jest.fn()
jest.mock('@/hooks/useWiki', () => ({
  useWikiPages: () => mockUseWikiPages(),
  useWikiPage: () => mockUseWikiPage(),
}))

describe('WikiBrowse', () => {
  beforeEach(() => mockPush.mockReset())

  it('lists pages and navigates to a page on tap', () => {
    mockUseWikiPages.mockReturnValue({
      pages: [{ id: 'p1', title: 'Anxiety', category: 'emotion', entry_count: 3 }],
      loading: false,
    })
    render(<WikiBrowse />)
    expect(screen.getByText('Anxiety')).toBeTruthy()
    expect(screen.getByText('emotion · 3 entries')).toBeTruthy()
    fireEvent.press(screen.getByText('Anxiety'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')
  })

  it('shows an empty state when there are no pages', () => {
    mockUseWikiPages.mockReturnValue({ pages: [], loading: false })
    render(<WikiBrowse />)
    expect(screen.getByText(/No pages yet/)).toBeTruthy()
  })
})

describe('WikiPageScreen', () => {
  it('renders the page title and synthesized content', () => {
    mockUseWikiPage.mockReturnValue({
      page: { id: 'p1', title: 'Anxiety', category: 'emotion', version: 2, entry_count: 3, content: 'You tend to expect the worst before meetings.' },
      loading: false,
    })
    render(<WikiPageScreen />)
    expect(screen.getByText('Anxiety')).toBeTruthy()
    expect(screen.getByText('You tend to expect the worst before meetings.')).toBeTruthy()
    expect(screen.getByText('emotion · v2 · 3 entries')).toBeTruthy()
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
