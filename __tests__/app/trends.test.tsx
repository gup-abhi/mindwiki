import { fireEvent, render, screen } from '@testing-library/react-native'

import TrendsScreen from '@/app/trends'

const mockBack = jest.fn()
const mockEntries = jest.fn()
const mockTimestamps = jest.fn()
const mockFreezes = jest.fn()
const mockTrending = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}))
jest.mock('@/hooks/useEntries', () => ({ useEntries: () => mockEntries() }))
jest.mock('@/hooks/useStreakTimestamps', () => ({ useStreakTimestamps: () => mockTimestamps() }))
jest.mock('@/hooks/useStreakFreezes', () => ({ useStreakFreezes: () => mockFreezes() }))
jest.mock('@/hooks/useWiki', () => ({ useTrendingPages: () => mockTrending() }))
jest.mock('@/components/StreakRescueModal', () => ({ StreakRescueModal: () => null }))
jest.mock('@/components/wiki/PageTrendView', () => ({
  PageTrendView: () => null,
  TrendLegend: () => null,
}))
jest.mock('@/components/insights/AffectMapView', () => ({ AffectMapView: () => null }))
jest.mock('@/components/insights/DistortionTrendView', () => ({ DistortionTrendView: () => null }))

const baseEntry = {
  id: 'e1',
  created_at: Date.now(),
  mood: 3,
  situation: 'private situation',
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
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEntries.mockReturnValue({ entries: [] })
  mockTimestamps.mockReturnValue({ timestamps: [] })
  mockFreezes.mockReturnValue({ frozenDays: new Set<number>(), applyFreezes: jest.fn() })
  mockTrending.mockReturnValue([])
})

describe('Trends screen', () => {
  it('shows the empty state without exposing entry content', () => {
    render(<TrendsScreen />)
    expect(screen.getByRole('header', { name: 'Reflection rhythm' })).toBeTruthy()
    expect(screen.getByText('Write a few entries and your mood trends will show up here.')).toBeTruthy()
    expect(screen.queryByText('private situation')).toBeNull()
  })

  it('renders populated trend sections and preserves back navigation', () => {
    mockEntries.mockReturnValue({ entries: [baseEntry] })
    render(<TrendsScreen />)
    expect(screen.getByText('Mood · last 14 days')).toBeTruthy()
    expect(screen.getByTestId('trends-back')).toBeTruthy()
    fireEvent.press(screen.getByTestId('trends-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})
