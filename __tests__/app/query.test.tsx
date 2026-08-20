import { render, screen, fireEvent } from '@testing-library/react-native'
import { BackHandler } from 'react-native'

import QueryScreen from '@/app/(tabs)/query'
import { type UIMessage } from '@/store/chat.store'

const mockUse = jest.fn()
const mockConversationArgs = jest.fn()
const mockPush = jest.fn()
const mockSend = jest.fn()
const mockRetry = jest.fn()
const mockOpenStarter = jest.fn()
const mockNew = jest.fn()
const mockLoad = jest.fn()

// Holder so the mock factory can expose the registered tabPress handler.
const mockNav: { tabPress?: () => void } = {}
// Captured hardware-back handler registered by the screen.
let backPressHandler: (() => boolean) | undefined

jest.mock('@/hooks/useConversation', () => ({
  useConversation: (...args: unknown[]) => {
    mockConversationArgs(...args)
    return mockUse()
  },
}))
jest.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    require('react').useEffect(() => cb(), [])
  },
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
  sending: false,
  suggestions: ['What patterns show up around Work?'],
  history: [] as { id: string; title: string | null; created_at: number; updated_at: number }[],
  send: mockSend,
  retry: mockRetry,
  openStarter: mockOpenStarter,
  newConversation: mockNew,
  loadConversation: mockLoad,
}

describe('QueryScreen (reflective conversation)', () => {
  beforeEach(() => {
    mockUse.mockReset()
    mockConversationArgs.mockReset()
    mockPush.mockReset()
    mockSend.mockReset()
    mockRetry.mockReset()
    mockOpenStarter.mockReset()
    mockNew.mockReset()
    mockLoad.mockReset()
    mockNav.tabPress = undefined
    backPressHandler = undefined
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((event, cb) => {
        if (event === 'hardwareBackPress') backPressHandler = cb as () => boolean
        return { remove: jest.fn() } as unknown as ReturnType<typeof BackHandler.addEventListener>
      })
  })

  afterEach(() => jest.restoreAllMocks())

  it('does not accept user-authored route params as a conversation starter', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    expect(mockConversationArgs).toHaveBeenCalledWith()
  })

  it('opens a starter via openStarter when tapped (reuses an existing conversation)', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    const starter = screen.getByText('What patterns show up around Work?')
    fireEvent.press(starter)
    expect(mockOpenStarter).toHaveBeenCalledWith('What patterns show up around Work?')
  })

  it('shows the Untangle a thought entry on the start screen', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    const untangle = screen.getByTestId('untangle-entry')
    expect(untangle).toBeTruthy()
    expect(untangle.props.style).toEqual(expect.objectContaining({ borderWidth: expect.any(Number) }))
  })

  it('keeps feeling chips at the full interaction target', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    expect(screen.getByTestId('feeling-chip-Anxious').props.style).toEqual(
      expect.objectContaining({ minHeight: 48 })
    )
  })

  it('tapping Untangle a thought pushes the /untangle route', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    fireEvent.press(screen.getByTestId('untangle-entry'))
    expect(mockPush).toHaveBeenCalledWith('/untangle')
  })

  it('seeds the composer from a feeling chip (does not send yet)', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    fireEvent.press(screen.getByTestId('feeling-chip-Anxious'))
    // the chip pre-fills the composer with an editable starter, without sending
    expect(screen.getByTestId('composer-input').props.value).toBe('I’ve been feeling anxious lately.')
    expect(mockSend).not.toHaveBeenCalled()
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

  it('shows a typing indicator instead of partial text while a reply is in flight', () => {
    mockUse.mockReturnValue({
      ...base,
      messages: [message({ role: 'user', content: 'hi' })],
      sending: true,
    })
    render(<QueryScreen />)
    expect(screen.getByTestId('typing-indicator')).toBeTruthy()
    expect(screen.getByLabelText('Assistant is replying')).toBeTruthy()
    expect(screen.queryByText('Thinking abou')).toBeNull()
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

  it('keeps suggestions and history on separate tabs (history hidden until selected)', () => {
    mockUse.mockReturnValue({
      ...base,
      history: [{ id: 'c1', title: 'A past chat', created_at: 0, updated_at: 0 }],
    })
    render(<QueryScreen />)
    // Start tab is default: suggestions show, history is hidden
    expect(screen.getByText('What patterns show up around Work?')).toBeTruthy()
    expect(screen.queryByText('A past chat')).toBeNull()
  })

  it('hardware back closes an open conversation instead of leaving the tab', () => {
    mockUse.mockReturnValue({
      ...base,
      messages: [message({ role: 'user', content: 'in a conversation' })],
    })
    render(<QueryScreen />)
    expect(typeof backPressHandler).toBe('function')
    const handled = backPressHandler?.()
    expect(handled).toBe(true) // consumed — does not leave to Home
    expect(mockNew).toHaveBeenCalled()
  })

  it('hardware back is not intercepted on the start screen', () => {
    mockUse.mockReturnValue(base) // no messages → start screen
    render(<QueryScreen />)
    const handled = backPressHandler?.()
    expect(handled).toBe(false) // default back happens (to Home)
    expect(mockNew).not.toHaveBeenCalled()
  })

  it('opens a past conversation from the History tab', () => {
    mockUse.mockReturnValue({
      ...base,
      history: [{ id: 'c1', title: 'A past chat', created_at: 0, updated_at: 0 }],
    })
    render(<QueryScreen />)
    fireEvent.press(screen.getByTestId('tab-history'))
    fireEvent.press(screen.getByText('A past chat'))
    expect(mockLoad).toHaveBeenCalledWith('c1')
  })

  it('shows guided paths on the Paths tab', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    fireEvent.press(screen.getByTestId('tab-paths'))
    expect(screen.getByText('Guided reflections')).toBeTruthy()
    expect(screen.getByText('Slow down and untangle what’s piling up.')).toBeTruthy()
  })

  it('opens the path runner from the Paths tab', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    fireEvent.press(screen.getByTestId('tab-paths'))
    fireEvent.press(screen.getByTestId('path-overwhelmed'))
    expect(mockPush).toHaveBeenCalledWith('/paths/overwhelmed')
  })
})
