import { render, screen, fireEvent } from '@testing-library/react-native'

import { MoversStrip } from '@/components/insights/MoversStrip'
import { type PageTrendEntry } from '@/services/insights/page-trend'

const mockPush = jest.fn()
const mockUseTrendingPages = jest.fn<PageTrendEntry[], []>(() => [])
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/hooks/useWiki', () => ({ useTrendingPages: () => mockUseTrendingPages() }))

const mover = (
  id: string,
  title: string,
  frequencyDirection: 'rising' | 'falling' | 'steady'
): PageTrendEntry => ({
  page: { id, title, category: 'emotion' },
  trend: {
    totalEntries: 6,
    weeks: [],
    frequencyDirection,
    moodDirection: 'steady',
    message: `${title} moved`,
  },
})

describe('MoversStrip', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockUseTrendingPages.mockReset().mockReturnValue([])
  })

  it('renders nothing when there are no movers', () => {
    render(<MoversStrip />)
    expect(screen.queryByTestId('home-movers')).toBeNull()
  })

  it('shows rising/falling concepts with a direction arrow and hides steady ones', () => {
    mockUseTrendingPages.mockReturnValue([
      mover('a', 'Anxiety', 'falling'),
      mover('w', 'Work', 'rising'),
      mover('c', 'Calm', 'steady'), // frequency didn't move → excluded from the strip
    ])
    render(<MoversStrip />)
    expect(screen.getByText('Anxiety ↓')).toBeTruthy()
    expect(screen.getByText('Work ↑')).toBeTruthy()
    expect(screen.queryByText(/Calm/)).toBeNull()
  })

  it('taps through to the concept’s page', () => {
    mockUseTrendingPages.mockReturnValue([mover('a', 'Anxiety', 'falling')])
    render(<MoversStrip />)
    fireEvent.press(screen.getByText('Anxiety ↓'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/a')
  })
})
