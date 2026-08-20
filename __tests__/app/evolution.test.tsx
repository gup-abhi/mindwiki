import { fireEvent, render, screen } from '@testing-library/react-native'

import PageEvolutionScreen from '@/app/wiki/[id]/evolution'

const mockBack = jest.fn()
const mockUseWikiPage = jest.fn()
const mockPageEvolution = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ id: 'p1' }),
}))

jest.mock('@/hooks/useWiki', () => ({
  useWikiPage: () => mockUseWikiPage(),
}))

jest.mock('@/services/wiki/evolution', () => ({
  pageEvolution: (page: {
    version: number
    content: string
    updated_at: number
    version_history: Array<{ version: number; content: string; updated_at: number }>
  }) => mockPageEvolution(page),
}))

const page = {
  id: 'p1',
  title: 'Anxiety',
  category: 'emotion',
  version: 2,
  entry_count: 3,
  content: 'Current page content.',
  updated_at: 1700001000000,
  version_history: [{ version: 1, content: 'Earlier page content.', updated_at: 1700000000000 }],
}

describe('PageEvolutionScreen', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockUseWikiPage.mockReset()
    mockPageEvolution.mockImplementation((currentPage) => ({
      versions: currentPage.version_history,
      current: {
        version: currentPage.version,
        content: currentPage.content,
        updated_at: currentPage.updated_at,
      },
      gaps: [],
      issues: [],
    }))
  })

  it('stacks the page header above actions and the horizontal version selector', () => {
    mockUseWikiPage.mockReturnValue({ page, loading: false })

    render(<PageEvolutionScreen />)

    expect(screen.getByRole('header', { name: 'Anxiety' })).toBeTruthy()
    expect(screen.getByTestId('evolution-mode')).toBeTruthy()
    expect(screen.getByLabelText('Page versions')).toBeTruthy()
    expect(screen.getByTestId('version-chip-v1')).toBeTruthy()
    expect(screen.getByTestId('version-chip-v2')).toBeTruthy()
  })

  it('shows a selected version in the content area without changing the header controls', () => {
    mockUseWikiPage.mockReturnValue({ page, loading: false })

    render(<PageEvolutionScreen />)
    fireEvent.press(screen.getByTestId('version-chip-v1'))

    expect(screen.getByTestId('version-viewer')).toBeTruthy()
    expect(screen.getByText('Earlier page content.')).toBeTruthy()
    expect(screen.getByTestId('evolution-mode')).toBeTruthy()
  })

  it('keeps the History note collapsed until its action is pressed', () => {
    mockPageEvolution.mockReturnValue({
      versions: page.version_history,
      current: { version: page.version, content: page.content, updated_at: page.updated_at },
      gaps: [{ fromVersion: 1, toVersion: 2, missing: 2 }],
      issues: [],
    })
    mockUseWikiPage.mockReturnValue({ page, loading: false })

    render(<PageEvolutionScreen />)

    expect(screen.getByRole('button', { name: 'Show history note' })).toBeTruthy()
    expect(screen.getByTestId('evolution-history-note').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: false })
    )
    expect(screen.queryByTestId('evolution-history-modal')).toBeNull()

    fireEvent.press(screen.getByTestId('evolution-history-note'))
    expect(screen.getByRole('button', { name: 'Hide history note' })).toBeTruthy()
    expect(screen.getByTestId('evolution-history-modal')).toBeTruthy()
    expect(screen.getByText('2 prior versions were sampled out between v1 and v2.')).toBeTruthy()
    expect(screen.getByTestId('evolution-history-note').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: true })
    )

    fireEvent.press(screen.getByLabelText('Close history note'))
    expect(screen.queryByTestId('evolution-history-modal')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show history note' })).toBeTruthy()

    fireEvent.press(screen.getByTestId('evolution-history-note'))
    expect(screen.getByTestId('evolution-history-modal')).toBeTruthy()
    fireEvent.press(screen.getByTestId('evolution-history-dismiss'))
    expect(screen.queryByTestId('evolution-history-modal')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show history note' })).toBeTruthy()

    fireEvent.press(screen.getByTestId('evolution-history-note'))
    expect(screen.getByTestId('evolution-history-modal')).toBeTruthy()
  })

  it('does not show a History note action when history is complete', () => {
    mockUseWikiPage.mockReturnValue({ page, loading: false })

    render(<PageEvolutionScreen />)

    expect(screen.queryByTestId('evolution-history-note')).toBeNull()
    expect(screen.queryByTestId('evolution-integrity-notice')).toBeNull()
  })

  it('renders loading and no-history states', () => {
    mockUseWikiPage.mockReturnValue({ page: null, loading: true })
    const { rerender } = render(<PageEvolutionScreen />)
    expect(screen.getByText('Loading…')).toBeTruthy()

    mockUseWikiPage.mockReturnValue({ page: { ...page, version_history: [] }, loading: false })
    rerender(<PageEvolutionScreen />)
    expect(screen.getByText(/hasn't evolved yet/)).toBeTruthy()
  })
})
