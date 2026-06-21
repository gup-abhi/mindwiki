import { fireEvent, render, screen } from '@testing-library/react-native'

import BreatheScreen from '@/app/breathe'

const mockBack = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: mockReplace }) }))

beforeEach(() => {
  mockBack.mockReset()
  mockReplace.mockReset()
})

describe('BreatheScreen', () => {
  it('starts on the first inhale of cycle one', () => {
    render(<BreatheScreen />)
    expect(screen.getByText('Breathe in')).toBeTruthy()
    expect(screen.getByText('Cycle 1 of 5')).toBeTruthy()
  })

  it('closes back to where it came from', () => {
    render(<BreatheScreen />)
    fireEvent.press(screen.getByTestId('breathe-close'))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('toggles the haptic switch without crashing', () => {
    render(<BreatheScreen />)
    fireEvent.press(screen.getByTestId('breathe-haptic'))
    expect(screen.getByText('Breathe in')).toBeTruthy() // still rendering the exercise
  })
})
