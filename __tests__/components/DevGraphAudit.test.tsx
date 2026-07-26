import { fireEvent, render, screen } from '@testing-library/react-native'

import { DevGraphAudit } from '@/components/DevGraphAudit'
import { renderWithTheme } from '@/test/renderWithTheme'

describe('DevGraphAudit', () => {
  it('lists every check (V1–V7) inside the modal', () => {
    renderWithTheme(<DevGraphAudit />)
    fireEvent.press(screen.getByTestId('dev-graph-audit-toggle'))
    for (const id of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']) {
      expect(screen.getByTestId(`dev-graph-audit-row-${id}`)).toBeTruthy()
    }
  })

  it('toggles a row done, then back to not-done, on press', () => {
    renderWithTheme(<DevGraphAudit />)
    expect(screen.getByText(/0\/7 done this session\./)).toBeTruthy()
    fireEvent.press(screen.getByTestId('dev-graph-audit-toggle'))

    const row = screen.getByTestId('dev-graph-audit-row-V2')
    expect(row).toBeTruthy()

    fireEvent.press(row)
    expect(screen.getByText(/1\/7 done this session\./)).toBeTruthy()

    fireEvent.press(row)
    expect(screen.getByText(/0\/7 done this session\./)).toBeTruthy()
  })

  it('closes the modal when Close is tapped', () => {
    renderWithTheme(<DevGraphAudit />)
    fireEvent.press(screen.getByTestId('dev-graph-audit-toggle'))
    expect(screen.getByTestId('dev-graph-audit-modal')).toBeTruthy()
    fireEvent.press(screen.getByTestId('dev-graph-audit-close'))
    expect(screen.queryByTestId('dev-graph-audit-modal')).toBeNull()
  })

  it('shows 0/7 by default and a Show matrix button before opening', () => {
    renderWithTheme(<DevGraphAudit />)
    expect(screen.getByText('Graph audit verification matrix')).toBeTruthy()
    expect(screen.getByText(/0\/7 done this session\./)).toBeTruthy()
    expect(screen.getByTestId('dev-graph-audit-toggle')).toBeTruthy()
  })
})