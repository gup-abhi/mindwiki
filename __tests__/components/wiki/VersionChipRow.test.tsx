import { fireEvent, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { VersionChipRow } from '@/components/wiki/VersionChipRow'
import { haptics } from '@/lib/haptics'
import { renderWithTheme } from '@/test/renderWithTheme'

jest.mock('@/lib/haptics', () => ({
  haptics: { light: jest.fn(), select: jest.fn(), success: jest.fn(), medium: jest.fn() },
}))

const versions = [
  { version: 1, updated_at: new Date(2024, 0, 1).getTime() },
  { version: 2, updated_at: new Date(2024, 0, 2).getTime() },
  { version: 5, updated_at: new Date(2024, 0, 5).getTime() },
]

describe('VersionChipRow', () => {
  it('renders each version and marks selected and compare chips', () => {
    renderWithTheme(
      <VersionChipRow
        versions={versions}
        selectedVersion={2}
        compareVersion={5}
        onSelect={jest.fn()}
      />
    )

    expect(screen.getByTestId('version-chip-v1')).toBeTruthy()
    expect(screen.getByTestId('version-chip-v2').props.accessibilityState.selected).toBe(true)
    expect(screen.getByTestId('version-chip-v5').props.accessibilityState.selected).toBe(true)
    expect(screen.queryByText('current')).toBeNull()
  })

  it('forwards pressed version and requests selection haptics', () => {
    const onSelect = jest.fn()
    renderWithTheme(
      <VersionChipRow
        versions={versions}
        selectedVersion={null}
        compareVersion={null}
        onSelect={onSelect}
      />
    )

    fireEvent.press(screen.getByTestId('version-chip-v2'))

    expect(onSelect).toHaveBeenCalledWith(2)
    expect(haptics.select).toHaveBeenCalled()
  })

  it('forwards presses in arbitrary order', () => {
    const onSelect = jest.fn()
    renderWithTheme(
      <VersionChipRow
        versions={versions}
        selectedVersion={null}
        compareVersion={null}
        onSelect={onSelect}
      />
    )

    fireEvent.press(screen.getByTestId('version-chip-v5'))
    fireEvent.press(screen.getByTestId('version-chip-v1'))
    fireEvent.press(screen.getByTestId('version-chip-v2'))

    expect(onSelect.mock.calls).toEqual([[5], [1], [2]])
  })

  it('keeps Android chips pressable after horizontal scrolling', () => {
    const originalPlatform = Platform.OS
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
    const onSelect = jest.fn()
    renderWithTheme(
      <VersionChipRow
        versions={versions}
        selectedVersion={null}
        compareVersion={null}
        onSelect={onSelect}
      />
    )

    fireEvent.scroll(screen.getByLabelText('Page versions'), {
      nativeEvent: { contentOffset: { x: 80, y: 0 } },
    })
    const chip = screen.getByTestId('version-chip-v2')
    fireEvent(chip, 'pressIn', { nativeEvent: { pageX: 120, pageY: 40 } })
    fireEvent(chip, 'pressOut', { nativeEvent: { pageX: 120, pageY: 40 } })

    expect(onSelect).toHaveBeenCalledWith(2)
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform })
  })

  it('does not select an Android chip when the gesture was a horizontal drag', () => {
    const originalPlatform = Platform.OS
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
    const onSelect = jest.fn()
    renderWithTheme(
      <VersionChipRow
        versions={versions}
        selectedVersion={null}
        compareVersion={null}
        onSelect={onSelect}
      />
    )

    const chip = screen.getByTestId('version-chip-v2')
    fireEvent(chip, 'pressIn', { nativeEvent: { pageX: 120, pageY: 40 } })
    fireEvent(chip, 'pressOut', { nativeEvent: { pageX: 160, pageY: 40 } })

    expect(onSelect).not.toHaveBeenCalled()
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform })
  })

  it('does not render sampled-out versions as chips', () => {
    renderWithTheme(
      <VersionChipRow
        versions={versions}
        selectedVersion={null}
        compareVersion={null}
        onSelect={jest.fn()}
      />
    )

    expect(screen.queryByTestId('version-gap-v2')).toBeNull()
    expect(screen.queryByText('⋮ 2 sampled out')).toBeNull()
    expect(screen.getByTestId('version-chip-v2')).toBeTruthy()
    expect(screen.getByTestId('version-chip-v5')).toBeTruthy()
  })
})