import { render, screen, fireEvent } from '@testing-library/react-native'

import SavedScreen from '@/app/saved'

const mockReplace = jest.fn()
let mockParams: { mood?: string } = {}
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}))

describe('SavedScreen', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockParams = {}
  })

  it('confirms the save and returns home on Done', () => {
    render(<SavedScreen />)
    expect(screen.getByText('Entry saved')).toBeTruthy()
    fireEvent.press(screen.getByText('Done'))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('offers a breather when the saved mood was low', () => {
    mockParams = { mood: '2' }
    render(<SavedScreen />)
    fireEvent.press(screen.getByTestId('saved-breathe'))
    expect(mockReplace).toHaveBeenCalledWith('/breathe')
  })

  it('does not offer a breather on a good day', () => {
    mockParams = { mood: '4' }
    render(<SavedScreen />)
    expect(screen.queryByTestId('saved-breathe')).toBeNull()
  })
})
