import { render, screen, fireEvent } from '@testing-library/react-native'

import QueryScreen from '@/app/(tabs)/query'
import { type UIMessage } from '@/store/chat.store'

const mockUse = jest.fn()
const mockPush = jest.fn()
const mockSend = jest.fn()
const mockRetry = jest.fn()
const mockNew = jest.fn()
const mockLoad = jest.fn()

// Holder so the mock factory can expose the registered tabPress handler.
const mockNav: { tabPress?: () => void } = {}

jest.mock('@/hooks/useConversation', () => ({ useConversation: () => mockUse() }))
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({
    addListener: (event: string, cb: () => void) => {
      if (event === 'tabPress') mockNav.tabPress = cb
      return () => {}
    },
  }),
}))

const message = (over: Partial<UIMessage> = {}): UIMessage => ({
  id: Math.random().toString(36),
  role: 'assistant',
  content: 'hello',
  sources: [],
  crisisTier: null,
  ...over,
})

const base = {
  messages: [] as UIMessage[],
  streaming: '',
  sending: false,
  suggestions: ['What patterns show up around Work?'],
  history: [] as { id: string; title: string | null; created_at: number; updated_at: number }[],
  send: mockSend,
  retry: mockRetry,
  newConversation: mockNew,
  loadConversation: mockLoad,
}

describe('QueryScreen (reflective conversation)', () => {
  beforeEach(() => {
    mockUse.mockReset()
    mockPush.mockReset()
    mockSend.mockReset()
    mockRetry.mockReset()
    mockNew.mockReset()
    mockLoad.mockReset()
    mockNav.tabPress = undefined
  })

  it('shows suggested starters and sends one when tapped', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    const starter = screen.getByText('What patterns show up around Work?')
    fireEvent.press(starter)
    expect(mockSend).toHaveBeenCalledWith('What patterns show up around Work?')
  })

  it('renders the conversation turns once a thread exists', () => {
    mockUse.mockReturnValue({
      ...base,
      messages: [
        message({ role: 'user', content: 'Why am I anxious?' }),
        message({ role: 'assistant', content: 'Deadlines spike it.' }),
      ],
    })
    render(<QueryScreen />)
    expect(screen.getByText('Why am I anxious?')).toBeTruthy()
    expect(screen.getByText('Deadlines spike it.')).toBeTruthy()
  })

  it('shows the streaming text while a reply is in flight', () => {
    mockUse.mockReturnValue({
      ...base,
      messages: [message({ role: 'user', content: 'hi' })],
      sending: true,
      streaming: 'Thinking abou',
    })
    render(<QueryScreen />)
    expect(screen.getByText('Thinking abou')).toBeTruthy()
  })

  it('shows a Try again button on a failed reply and retries when tapped', () => {
    mockUse.mockReturnValue({
      ...base,
      messages: [
        message({ role: 'user', content: 'tell me a lot' }),
        message({ role: 'assistant', content: 'Something went wrong — please try again.', failed: true }),
      ],
    })
    render(<QueryScreen />)
    fireEvent.press(screen.getByTestId('retry'))
    expect(mockRetry).toHaveBeenCalled()
  })

  it('resets to the start screen when the Reflect tab is pressed', () => {
    mockUse.mockReturnValue({
      ...base,
      messages: [message({ role: 'user', content: 'mid conversation' })],
    })
    render(<QueryScreen />)
    expect(typeof mockNav.tabPress).toBe('function')
    mockNav.tabPress?.()
    expect(mockNew).toHaveBeenCalled()
  })

  it('opens a past conversation from history', () => {
    mockUse.mockReturnValue({
      ...base,
      history: [{ id: 'c1', title: 'A past chat', created_at: 0, updated_at: 0 }],
    })
    render(<QueryScreen />)
    fireEvent.press(screen.getByText('A past chat'))
    expect(mockLoad).toHaveBeenCalledWith('c1')
  })
})
