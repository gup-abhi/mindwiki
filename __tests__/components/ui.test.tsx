import { fireEvent, screen } from '@testing-library/react-native'

import { Button, Card, Chip, EmptyState, ProgressBar, Screen, Text } from '@/components/ui'
import { haptics } from '@/lib/haptics'
import { renderWithTheme } from '@/test/renderWithTheme'

jest.mock('@/lib/haptics', () => ({ haptics: { light: jest.fn(), select: jest.fn(), success: jest.fn(), medium: jest.fn() } }))

describe('ui primitives', () => {
  it('Text renders its content', () => {
    renderWithTheme(<Text>hello</Text>)
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('Button fires onPress + haptic', () => {
    const onPress = jest.fn()
    renderWithTheme(<Button title="Go" onPress={onPress} testID="btn" />)
    fireEvent.press(screen.getByTestId('btn'))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(haptics.light).toHaveBeenCalled()
  })

  it('Button does nothing when disabled', () => {
    const onPress = jest.fn()
    renderWithTheme(<Button title="Go" onPress={onPress} disabled testID="btn2" />)
    fireEvent.press(screen.getByTestId('btn2'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('Card renders children and is pressable', () => {
    const onPress = jest.fn()
    renderWithTheme(
      <Card onPress={onPress} testID="card">
        <Text>body</Text>
      </Card>
    )
    fireEvent.press(screen.getByTestId('card'))
    expect(onPress).toHaveBeenCalled()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('Chip reflects selected + fires onPress', () => {
    const onPress = jest.fn()
    renderWithTheme(<Chip label="All" selected onPress={onPress} testID="chip" />)
    const chip = screen.getByTestId('chip')
    expect(chip.props.accessibilityState.selected).toBe(true)
    fireEvent.press(chip)
    expect(onPress).toHaveBeenCalled()
  })

  it('ProgressBar + Screen + EmptyState render', () => {
    renderWithTheme(
      <Screen>
        <ProgressBar progress={0.5} testID="pb" />
        <EmptyState title="Nothing here" message="Add something" />
      </Screen>
    )
    expect(screen.getByTestId('pb')).toBeTruthy()
    expect(screen.getByText('Nothing here')).toBeTruthy()
  })
})
