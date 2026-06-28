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
  emotionDisguise: null,
  emotionUndersell: null,
  weeklyRhythm: null,
  momentum: null,
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

  it('stacks the gated insights into a swipe deck with a dot per card', () => {
    mockUseDigest.mockReturnValue({
      digest: {
        ...digest,
        momentum: { signals: ['mood'], message: 'You are moving.' },
        emotionDisguise: { days: 3, named: 'Hopeful', inferred: 'anxiety', message: 'Named Hopeful, read anxiety.' },
        weeklyRhythm: { weekday: 'Wednesday', timeOfDay: 'afternoon', distortion: 'catastrophizing', occurrences: 3, message: 'Wednesday afternoons.' },
      },
      loading: false,
    })
    render(<DigestScreen />)

    // All three insight cards render inside the deck…
    expect(screen.getByText('You are moving.')).toBeTruthy()
    expect(screen.getByText('Named Hopeful, read anxiety.')).toBeTruthy()
    expect(screen.getByText('Wednesday afternoons.')).toBeTruthy()
    // …one dot each…
    expect(screen.getByTestId('insight-dot-0')).toBeTruthy()
    expect(screen.getByTestId('insight-dot-2')).toBeTruthy()
    // …and the two summaries still render below the deck.
    expect(screen.getByText('Anxiety was your most frequent emotion.')).toBeTruthy()
    expect(screen.getByText('Your tougher days often carried anxiety.')).toBeTruthy()
  })

  it('shows no carousel dots when no gated insight fired', () => {
    mockUseDigest.mockReturnValue({ digest, loading: false })
    render(<DigestScreen />)
    expect(screen.queryByTestId('insight-carousel')).toBeNull()
    expect(screen.queryByTestId('insight-dot-0')).toBeNull()
  })
})
