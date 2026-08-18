import { render, screen } from '@testing-library/react-native'
import * as Reanimated from 'react-native-reanimated'

import { MessageBubble } from '@/components/wiki/MessageBubble'
import { TypingIndicator } from '@/components/wiki/TypingIndicator'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { type UIMessage } from '@/store/chat.store'

jest.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(),
}))

const reducedMotionMock = useReducedMotion as jest.MockedFunction<typeof useReducedMotion>

function message(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    content: 'A complete reply.',
    sources: [],
    crisisTier: null,
    ...overrides,
  }
}

describe('Reflect pending and message motion', () => {
  beforeEach(() => {
    reducedMotionMock.mockReturnValue(false)
    jest.clearAllMocks()
  })

  it('renders three decorative dots inside one accessible busy indicator', () => {
    render(<TypingIndicator />)

    expect(screen.getAllByTestId('typing-dot', { includeHiddenElements: true })).toHaveLength(3)
    expect(screen.getByLabelText('Assistant is replying').props.accessibilityState).toEqual({ busy: true })
    expect(screen.getByTestId('typing-indicator').props.accessibilityLiveRegion).toBe('polite')
  })

  it('does not repeat dot animation when reduced motion is enabled', () => {
    reducedMotionMock.mockReturnValue(true)
    const repeatSpy = jest.spyOn(Reanimated, 'withRepeat')

    render(<TypingIndicator />)

    expect(repeatSpy).not.toHaveBeenCalled()
  })

  it('animates a new user message from the right and an assistant message from the left', () => {
    const sharedValueSpy = jest.spyOn(Reanimated, 'useSharedValue')

    const user = render(<MessageBubble reducedMotion={false} message={message({ role: 'user', animateEntry: true })} />)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(1, 0)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(2, 16)
    user.unmount()

    sharedValueSpy.mockClear()
    render(<MessageBubble reducedMotion={false} message={message({ id: 'message-2', animateEntry: true })} />)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(1, 0)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(2, -16)
  })

  it('mounts restored and reduced-motion messages at their final position', () => {
    const sharedValueSpy = jest.spyOn(Reanimated, 'useSharedValue')

    const restored = render(<MessageBubble reducedMotion={false} message={message()} />)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(1, 1)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(2, 0)
    restored.unmount()

    sharedValueSpy.mockClear()
    render(<MessageBubble reducedMotion message={message({ animateEntry: true })} />)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(1, 1)
    expect(sharedValueSpy).toHaveBeenNthCalledWith(2, 0)
  })
})
