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
  })

  it('does not impose private-writing defaults on ordinary fields', () => {
    render(<TextField value="" onChangeText={jest.fn()} testID="ordinary-input" />)

    const input = screen.getByTestId('ordinary-input')
    expect(input.props.autoCorrect).toBeUndefined()
    expect(input.props.autoComplete).toBeUndefined()
  })
})