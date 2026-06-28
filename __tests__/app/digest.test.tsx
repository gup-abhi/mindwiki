import { render, screen } from '@testing-library/react-native'

import DigestScreen from '@/app/digest'
import { type Digest } from '@/services/digest/generator'

const mockUseDigest = jest.fn()
jest.mock('@/hooks/useDigest', () => ({ useDigest: () => mockUseDigest() }))
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }))

const digest: Digest = {
  weekStart: 0,
  weekEnd: 1,
  entryCount: 7,
  dayCount: 3,
  avgMood: 3,
  moodDelta: 0.4,
  moodArc: [
    { day: 1, mood: 2 },
    { day: 2, mood: 4 },
    { day: 3, mood: 3 },
  ],
  emotionMix: [
    { label: 'anxiety', count: 4 },
    { label: 'joy', count: 2 },
  ],
  brightest: { day: 2, mood: 4, weekday: 'Tue' },
  toughest: { day: 1, mood: 2, weekday: 'Mon' },
  pattern: 'Anxiety was your most frequent emotion.',
  correlation: 'Your tougher days often carried anxiety.',
  moodBlindSpot: null,
  selfCriticism: null,
  question: 'What grounds you when things feel heavy?',
  quote: 'A hard week is data, not a definition.',
}

describe('DigestScreen', () => {
  it('renders the dashboard when a digest exists', () => {
    mockUseDigest.mockReturnValue({ digest, loading: false })
    render(<DigestScreen />)

    expect(screen.getByText('Your week')).toBeTruthy()
    expect(screen.getAllByTestId('mood-point')).toHaveLength(3) // mood arc
    expect(screen.getByText('3.0')).toBeTruthy() // avg mood tile
    expect(screen.getByText('↑0.4')).toBeTruthy() // week-over-week delta tile
    expect(screen.getByText(/Brightest Tue/)).toBeTruthy() // best-day callout
    expect(screen.getByText('Anxiety was your most frequent emotion.')).toBeTruthy() // pattern
    expect(screen.getByText('Your tougher days often carried anxiety.')).toBeTruthy() // correlation
    expect(screen.getByText('What grounds you when things feel heavy?')).toBeTruthy() // question
    expect(screen.getByText(/A hard week is data/)).toBeTruthy() // quote
  })

  it('shows the synthesis banner up top while themes are being worked out', () => {
    mockUseDigest.mockReturnValue({ digest, loading: false, synthesizing: true })
    render(<DigestScreen />)
    expect(screen.getByText('Looking for themes across your week…')).toBeTruthy()
  })

  it('hides the synthesis banner once synthesis has landed', () => {
    mockUseDigest.mockReturnValue({
      digest: { ...digest, synthesis: { themes: ['t'], patterns: [], openQuestions: [], flaggedClaims: [] } },
      loading: false,
      synthesizing: true,
    })
    render(<DigestScreen />)
    expect(screen.queryByText('Looking for themes across your week…')).toBeNull()
  })

  it('shows an empty state when there is no digest', () => {
    mockUseDigest.mockReturnValue({ digest: null, loading: false })
    render(<DigestScreen />)
    expect(screen.getByText('No digest yet')).toBeTruthy()
  })
})
