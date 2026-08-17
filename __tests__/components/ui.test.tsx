import { fireEvent, screen } from '@testing-library/react-native'

import { Button, Card, Chip, EmptyState, IconButton, ListRow, ProgressBar, Screen, SegmentedControl, Text } from '@/components/ui'
import { haptics } from '@/lib/haptics'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { renderWithTheme } from '@/test/renderWithTheme'

jest.mock('@/lib/haptics', () => ({ haptics: { light: jest.fn(), select: jest.fn(), success: jest.fn(), medium: jest.fn() } }))
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => false) }))

const mockedUseReducedMotion = jest.mocked(useReducedMotion)

const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flattenStyle))
  return style && typeof style === 'object' ? style as Record<string, unknown> : {}
}

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

  it('Button keeps its accessible name and exposes busy state while loading', () => {
    renderWithTheme(<Button title="Save entry" onPress={jest.fn()} loading testID="loading-btn" />)
    const button = screen.getByTestId('loading-btn')
    expect(button.props.accessibilityLabel).toBe('Save entry')
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }))
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

  it('IconButton uses a full 48dp target and forwards accessibility state', () => {
    renderWithTheme(
      <IconButton
        name="chevron-down"
        onPress={jest.fn()}
        accessibilityLabel="Expand"
        accessibilityState={{ expanded: false }}
        testID="icon-button"
      />
    )
    const button = screen.getByTestId('icon-button')
    expect(button.props.accessibilityState.expanded).toBe(false)
    expect(flattenStyle(button.props.style)).toEqual(expect.objectContaining({ minWidth: 48, minHeight: 48 }))
  })

  it('Chip reflects selected + fires onPress', () => {
    const onPress = jest.fn()
    renderWithTheme(<Chip label="All" selected onPress={onPress} testID="chip" />)
    const chip = screen.getByTestId('chip')
    expect(chip.props.accessibilityState.checked).toBe(true)
    expect(chip.props.accessibilityRole).toBe('checkbox')
    fireEvent.press(chip)
    expect(onPress).toHaveBeenCalled()
  })

  it('Chip supports explicit semantic modes and a full target', () => {
    renderWithTheme(<Chip label="Only mine" selected onPress={jest.fn()} mode="single" testID="single-chip" />)
    const chip = screen.getByTestId('single-chip')
    expect(chip.props.accessibilityRole).toBe('radio')
    expect(chip.props.accessibilityState.selected).toBe(true)
    expect(flattenStyle(chip.props.style)).toEqual(expect.objectContaining({ minHeight: 48 }))

    renderWithTheme(<Chip label="Enabled" selected onPress={jest.fn()} mode="toggle" testID="toggle-chip" />)
    expect(screen.getByTestId('toggle-chip').props.accessibilityRole).toBe('switch')
    expect(screen.getByTestId('toggle-chip').props.accessibilityState.checked).toBe(true)
  })

  it('Chip supports static content without claiming an interactive role', () => {
    renderWithTheme(<Chip label="Journal" testID="static-chip" />)
    const chip = screen.getByTestId('static-chip')
    expect(chip.props.accessibilityRole).toBeUndefined()
    expect(chip.props.accessibilityState).toBeUndefined()
  })

  it('maps heading variants to header semantics', () => {
    renderWithTheme(<Text variant="heading">Section title</Text>)
    expect(screen.getByText('Section title').props.accessibilityRole).toBe('header')
  })

  it('forwards disabled semantics to actionable primitives', () => {
    renderWithTheme(<IconButton name="close" onPress={jest.fn()} accessibilityLabel="Close" disabled testID="disabled-icon" />)
    expect(screen.getByTestId('disabled-icon').props.accessibilityState.disabled).toBe(true)

    renderWithTheme(<SegmentedControl options={[{ key: 'one', label: 'One' }]} selectedKey="one" onChange={jest.fn()} disabled testID="disabled-tabs" />)
    expect(screen.getByTestId('disabled-tabs-one').props.accessibilityState.disabled).toBe(true)
  })

  it('covers static and alternate primitive states', () => {
    renderWithTheme(<Button title="Secondary" variant="secondary" size="lg" onPress={jest.fn()} testID="secondary-button" />)
    expect(screen.getByTestId('secondary-button')).toBeTruthy()

    renderWithTheme(<Chip label="Do" mode="action" onPress={jest.fn()} testID="action-chip" />)
    expect(screen.getByTestId('action-chip').props.accessibilityRole).toBe('button')

    renderWithTheme(<ListRow title="Read only" subtitle="Details" testID="static-row" />)
    expect(screen.getByTestId('static-row').props.accessibilityRole).toBeUndefined()

    renderWithTheme(<SegmentedControl options={[{ key: 'one', label: 'One' }, { key: 'two', label: 'Two' }]} selectedKey="one" onChange={jest.fn()} testID="tabs" />)
    expect(screen.getByTestId('tabs-two').props.accessibilityState.selected).toBe(false)
  })

  it('preserves disabled loading semantics', () => {
    renderWithTheme(<Button title="Submit" onPress={jest.fn()} disabled loading testID="busy-button" />)
    expect(screen.getByTestId('busy-button').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true, busy: true }))
  })

  it('handles chips with a disabled selection', () => {
    renderWithTheme(<Chip label="Unavailable" selected disabled onPress={jest.fn()} testID="disabled-chip" />)
    expect(screen.getByTestId('disabled-chip').props.accessibilityState).toEqual(expect.objectContaining({ checked: true, disabled: true }))
  })

  it('handles icon buttons with custom state', () => {
    renderWithTheme(<IconButton name="chevron-down" onPress={jest.fn()} accessibilityLabel="Expand" accessibilityState={{ expanded: true }} testID="expanded-icon" />)
    expect(screen.getByTestId('expanded-icon').props.accessibilityState).toEqual({ expanded: true, disabled: false })
  })

  it('announces empty state updates politely', () => {
    renderWithTheme(<EmptyState title="No entries" testID="empty-state" />)
    expect(screen.getByTestId('empty-state').props.accessibilityLiveRegion).toBe('polite')
  })

  it('ListRow gives actionable rows a 48dp target and forwards semantics', () => {
    renderWithTheme(
      <ListRow
        title="Appearance"
        onPress={jest.fn()}
        accessibilityLabel="Open appearance settings"
        accessibilityState={{ expanded: false }}
        testID="row"
      />
    )
    const row = screen.getByTestId('row')
    expect(flattenStyle(row.props.style)).toEqual(expect.objectContaining({ minHeight: 48 }))
    expect(row.props.accessibilityLabel).toBe('Open appearance settings')
    expect(row.props.accessibilityState.expanded).toBe(false)
  })

  it('EmptyState exposes an optional next action', () => {
    renderWithTheme(
      <EmptyState
        title="No entries"
        action={{ label: 'New entry', onPress: jest.fn(), testID: 'empty-action' }}
      />
    )
    expect(screen.getByTestId('empty-action')).toBeTruthy()
  })

  it('Button skips press animation when reduced motion is enabled', () => {
    mockedUseReducedMotion.mockReturnValue(true)
    renderWithTheme(<Button title="Go" onPress={jest.fn()} testID="motion-button" />)
    fireEvent(screen.getByTestId('motion-button'), 'pressIn')
    fireEvent(screen.getByTestId('motion-button'), 'pressOut')
    expect(screen.getByTestId('motion-button')).toBeTruthy()
  })

  afterEach(() => {
    mockedUseReducedMotion.mockReturnValue(false)
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
