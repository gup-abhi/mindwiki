import { screen, fireEvent } from '@testing-library/react-native'

import { SegmentedControl } from '@/components/ui'
import { renderWithTheme } from '@/test/renderWithTheme'

describe('SegmentedControl', () => {
  it('marks the selected tab and exposes full targets', () => {
    renderWithTheme(
      <SegmentedControl
        options={[
          { key: 'start', label: 'Start', testID: 'tab-start' },
          { key: 'history', label: 'History', testID: 'tab-history' },
        ]}
        selectedKey="start"
        onChange={jest.fn()}
      />
    )

    const start = screen.getByTestId('tab-start')
    expect(start.props.accessibilityRole).toBe('tab')
    expect(start.props.accessibilityState.selected).toBe(true)
    expect(start.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 48 })]))
    expect(screen.getByTestId('tab-history').props.accessibilityState.selected).toBe(false)
  })

  it('reports the selected key when a tab is pressed', () => {
    const onChange = jest.fn()
    renderWithTheme(
      <SegmentedControl
        options={[{ key: 'start', label: 'Start' }]}
        selectedKey="start"
        onChange={onChange}
        testID="tabs"
      />
    )

    fireEvent.press(screen.getByTestId('tabs-start'))
    expect(onChange).toHaveBeenCalledWith('start')
  })
})
