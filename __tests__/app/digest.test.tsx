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
  moodArc: [
    { day: 1, mood: 2 },
    { day: 2, mood: 4 },
    { day: 3, mood: 3 },
  ],
  observations: ['7 entries across 3 days.', 'Your average mood was 3.0 out of 5.'],
  pattern: 'Anxiety was your most frequent emotion.',
  correlation: 'Your tougher days often carried anxiety.',
  question: 'What grounds you when things feel heavy?',
  quote: 'A hard week is data, not a definition.',
}

describe('DigestScreen', () => {
  it('renders all six sections when a digest exists', () => {
    mockUseDigest.mockReturnValue({ digest, loading: false })
    render(<DigestScreen />)

    expect(screen.getByText('Your week')).toBeTruthy()
    expect(screen.getAllByTestId('mood-point')).toHaveLength(3) // mood arc
    expect(screen.getByText('7 entries across 3 days.')).toBeTruthy() // observation
    expect(screen.getByText('Anxiety was your most frequent emotion.')).toBeTruthy() // pattern
    expect(screen.getByText('Your tougher days often carried anxiety.')).toBeTruthy() // correlation
    expect(screen.getByText('What grounds you when things feel heavy?')).toBeTruthy() // question
    expect(screen.getByText(/A hard week is data/)).toBeTruthy() // quote
  })

  it('shows an empty state when there is no digest', () => {
    mockUseDigest.mockReturnValue({ digest: null, loading: false })
    render(<DigestScreen />)
    expect(screen.getByText('No digest yet')).toBeTruthy()
  })
})
