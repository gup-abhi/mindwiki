import { render, screen, fireEvent } from '@testing-library/react-native'

import SavedScreen from '@/app/saved'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}))

describe('SavedScreen', () => {
  beforeEach(() => mockReplace.mockReset())

  it('confirms the save and returns home on Done', () => {
    render(<SavedScreen />)
    expect(screen.getByText('Entry saved')).toBeTruthy()
    fireEvent.press(screen.getByText('Done'))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })
})
