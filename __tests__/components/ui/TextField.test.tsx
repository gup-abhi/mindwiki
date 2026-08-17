import { render, screen } from '@testing-library/react-native'

import { TextField } from '@/components/ui/TextField'

describe('TextField privacy mode', () => {
  it('disables keyboard learning and autofill for sensitive text', () => {
    render(<TextField sensitive value="" onChangeText={jest.fn()} testID="private-input" />)

    const input = screen.getByTestId('private-input')
    expect(input.props.autoCorrect).toBe(false)
    expect(input.props.spellCheck).toBe(false)
    expect(input.props.autoComplete).toBe('off')
    expect(input.props.importantForAutofill).toBe('noExcludeDescendants')
    expect(input.props.textContentType).toBe('none')
  })

  it('does not impose private-writing defaults on ordinary fields', () => {
    render(<TextField value="" onChangeText={jest.fn()} testID="ordinary-input" />)

    const input = screen.getByTestId('ordinary-input')
    expect(input.props.autoCorrect).toBeUndefined()
    expect(input.props.autoComplete).toBeUndefined()
  })

  it('exposes the visible label and announces errors', () => {
    render(<TextField label="Email" error="Enter a valid email" value="" onChangeText={jest.fn()} testID="error-input" />)

    const input = screen.getByTestId('error-input')
    expect(input.props.accessibilityLabel).toBe('Email')
    expect(screen.getByText('Enter a valid email').props.accessibilityLiveRegion).toBe('polite')
  })

  it('exposes disabled state for read-only fields', () => {
    render(<TextField editable={false} value="Saved" onChangeText={jest.fn()} testID="read-only-input" />)
    expect(screen.getByTestId('read-only-input').props.accessibilityState).toEqual({ disabled: true })
  })
})