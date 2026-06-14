import { render, screen, fireEvent } from '@testing-library/react-native'

import HiddenNodesScreen from '@/app/graph/hidden'

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))

const mockRestore = jest.fn()
const mockUse = jest.fn()
jest.mock('@/hooks/useGraph', () => ({ useNodeDismissals: () => mockUse() }))

describe('HiddenNodesScreen', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockRestore.mockReset()
    mockUse.mockReturnValue({
      dismissals: [{ id: 'emotion:anxiety', type: 'emotion', label: 'Anxiety', dismissed_at: 1, updated_at: 1 }],
      restore: mockRestore,
    })
  })

  it('lists dropped nodes and restores one', () => {
    render(<HiddenNodesScreen />)
    expect(screen.getByText('Anxiety')).toBeTruthy()
    fireEvent.press(screen.getByTestId('hidden-restore-emotion:anxiety'))
    expect(mockRestore).toHaveBeenCalledWith('emotion:anxiety')
  })

  it('shows an empty state when nothing is hidden', () => {
    mockUse.mockReturnValue({ dismissals: [], restore: mockRestore })
    render(<HiddenNodesScreen />)
    expect(screen.getByText(/Nothing hidden/)).toBeTruthy()
  })

  it('navigates back', () => {
    render(<HiddenNodesScreen />)
    fireEvent.press(screen.getByTestId('hidden-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})
