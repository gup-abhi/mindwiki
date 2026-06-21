import { render, screen, fireEvent } from '@testing-library/react-native'

import CrisisScreen from '@/app/crisis'

const mockReplace = jest.fn()
const mockPush = jest.fn()
let mockTier = '3'
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => ({ tier: mockTier }),
}))

describe('CrisisScreen', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockPush.mockReset()
    mockTier = '3'
  })

  it('shows tier-3 support copy, the 988 action, and resources', () => {
    render(<CrisisScreen />)
    expect(screen.getByText('Please reach out — you matter')).toBeTruthy()
    expect(screen.getAllByText('Call or text 988').length).toBeGreaterThan(0)
    expect(screen.getByText('988 Suicide & Crisis Lifeline')).toBeTruthy()
    expect(screen.getByText('Crisis Text Line')).toBeTruthy()
  })

  it('tier 1 is gentle: no red 988 button and no resource list', () => {
    mockTier = '1'
    render(<CrisisScreen />)
    expect(screen.getByText('Thanks for writing this down')).toBeTruthy()
    expect(screen.queryByText('Call or text 988')).toBeNull()
    expect(screen.queryByText('988 Suicide & Crisis Lifeline')).toBeNull()
    expect(screen.getByText(/988 is there/)).toBeTruthy() // quiet support line
  })

  it('Continue returns home', () => {
    render(<CrisisScreen />)
    fireEvent.press(screen.getByText('Continue'))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('offers a breathing exercise as grounding at tier 2', () => {
    mockTier = '2'
    render(<CrisisScreen />)
    fireEvent.press(screen.getByTestId('crisis-breathe'))
    expect(mockPush).toHaveBeenCalledWith('/breathe')
  })

  it('does not offer the breathing exercise at tier 3 (988 stays primary)', () => {
    render(<CrisisScreen />) // tier 3
    expect(screen.queryByTestId('crisis-breathe')).toBeNull()
  })
})
