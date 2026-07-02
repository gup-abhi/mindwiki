import { render, screen, fireEvent } from '@testing-library/react-native'

import PathsScreen from '@/app/paths'
import { GUIDED_PATHS } from '@/lib/guided-paths'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

describe('PathsScreen', () => {
  beforeEach(() => mockPush.mockReset())

  it('lists every guided path', () => {
    render(<PathsScreen />)
    for (const path of GUIDED_PATHS) {
      expect(screen.getByText(path.title)).toBeTruthy()
    }
  })

  it('opens the runner for the tapped path', () => {
    render(<PathsScreen />)
    fireEvent.press(screen.getByTestId(`path-${GUIDED_PATHS[0].id}`))
    expect(mockPush).toHaveBeenCalledWith(`/paths/${GUIDED_PATHS[0].id}`)
  })
})
