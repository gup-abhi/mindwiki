import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react-native'

import {
  ConversationComposer,
  type ConversationComposerHandle,
} from '@/components/wiki/ConversationComposer'

describe('ConversationComposer', () => {
  it('sends the trimmed text and clears the field', () => {
    const onSend = jest.fn()
    render(<ConversationComposer sending={false} onSend={onSend} />)
    fireEvent.changeText(screen.getByTestId('composer-input'), '  hello there  ')
    fireEvent.press(screen.getByTestId('composer-send'))
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect(screen.getByTestId('composer-input').props.value).toBe('')
  })

  it('does not send while a reply is streaming', () => {
    const onSend = jest.fn()
    render(<ConversationComposer sending onSend={onSend} />)
    fireEvent.changeText(screen.getByTestId('composer-input'), 'hi')
    fireEvent.press(screen.getByTestId('composer-send'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('seed() pre-fills the input without sending', () => {
    const ref = createRef<ConversationComposerHandle>()
    const onSend = jest.fn()
    render(<ConversationComposer ref={ref} sending={false} onSend={onSend} />)
    act(() => ref.current?.seed('I’ve been feeling anxious lately.'))
    expect(screen.getByTestId('composer-input').props.value).toBe('I’ve been feeling anxious lately.')
    expect(onSend).not.toHaveBeenCalled()
  })
})
