import { fireEvent, render, screen } from '@testing-library/react-native'

import { DesignPreview } from '@/components/dev/DesignPreview'

describe('DesignPreview', () => {
  it('renders the Quiet Editorial fixture groups without authored content', () => {
    render(<DesignPreview onClose={jest.fn()} />)

    expect(screen.getByTestId('design-preview-close')).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Design preview' })).toBeTruthy()
    expect(screen.getByText('Type and surfaces')).toBeTruthy()
    expect(screen.getByText('Actions')).toBeTruthy()
    expect(screen.getByText('Selection and navigation')).toBeTruthy()
    expect(screen.getByText('Forms and states')).toBeTruthy()
    expect(screen.getByText('Truthful status')).toBeTruthy()
    expect(screen.getByText('Static, non-sensitive examples of the Quiet Editorial interface contract.')).toBeTruthy()
    expect(screen.queryByText(/journal entry|meeting|work conflict/i)).toBeNull()
  })

  it('closes through the supplied callback', () => {
    const onClose = jest.fn()
    render(<DesignPreview onClose={onClose} />)
    fireEvent.press(screen.getByTestId('design-preview-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
