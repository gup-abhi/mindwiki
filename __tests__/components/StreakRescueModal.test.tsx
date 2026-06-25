import { fireEvent, render, screen } from '@testing-library/react-native'

import { StreakRescueModal } from '@/components/StreakRescueModal'

describe('StreakRescueModal', () => {
  const base = {
    visible: true,
    streakLength: 12,
    freezesNeeded: 1,
    onUse: jest.fn(),
    onDismiss: jest.fn(),
  }
  beforeEach(() => {
    base.onUse.mockClear()
    base.onDismiss.mockClear()
  })

  it('shows the at-risk streak and singular freeze copy', () => {
    render(<StreakRescueModal {...base} />)
    expect(screen.getByText('Your 12-day streak is at risk')).toBeTruthy()
    expect(screen.getByText(/You missed 1 day\. Use 1 freeze/)).toBeTruthy()
  })

  it('pluralizes for a multi-day gap', () => {
    render(<StreakRescueModal {...base} freezesNeeded={2} />)
    expect(screen.getByText(/You missed 2 days\. Use 2 freezes/)).toBeTruthy()
  })

  it('calls onUse and onDismiss from the buttons', () => {
    render(<StreakRescueModal {...base} />)
    fireEvent.press(screen.getByTestId('rescue-use'))
    expect(base.onUse).toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('rescue-dismiss'))
    expect(base.onDismiss).toHaveBeenCalled()
  })
})
