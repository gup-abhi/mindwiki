import { render, screen, fireEvent } from '@testing-library/react-native'

import CrisisScreen from '@/app/crisis'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ tier: '3' }),
}))

describe('CrisisScreen', () => {
  beforeEach(() => mockReplace.mockReset())

  it('shows tier-3 support copy, the 988 action, and resources', () => {
    render(<CrisisScreen />)
    expect(screen.getByText('Please reach out — you matter')).toBeTruthy()
    expect(screen.getAllByText('Call or text 988').length).toBeGreaterThan(0)
    expect(screen.getByText('988 Suicide & Crisis Lifeline')).toBeTruthy()
    expect(screen.getByText('Crisis Text Line')).toBeTruthy()
  })

  it('Continue returns home', () => {
    render(<CrisisScreen />)
    fireEvent.press(screen.getByText('Continue'))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })
})
