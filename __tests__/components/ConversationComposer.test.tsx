import { fireEvent, render, screen } from '@testing-library/react-native'

import { ConversationComposer } from '@/components/wiki/ConversationComposer'

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

  it('seed prop pre-fills the input without sending', () => {
    const onSend = jest.fn()
    const { rerender } = render(<ConversationComposer sending={false} onSend={onSend} seed={null} />)
    rerender(
      <ConversationComposer
        sending={false}
        onSend={onSend}
        seed={{ text: 'I’ve been feeling anxious lately.', nonce: 1 }}
      />
    )
    expect(screen.getByTestId('composer-input').props.value).toBe('I’ve been feeling anxious lately.')
    expect(onSend).not.toHaveBeenCalled()
  })
})
