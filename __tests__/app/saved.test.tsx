import { render, screen, fireEvent } from '@testing-library/react-native'

import SavedScreen from '@/app/saved'

const mockReplace = jest.fn()
let mockParams: { id?: string; mood?: string } = {}

jest.mock('@/hooks/useEntryLifecycle', () => ({
  useEntryLifecycle: jest.fn(() => ({ status: 'saved', refresh: jest.fn() })),
}))

const { useEntryLifecycle } = require('@/hooks/useEntryLifecycle') as { useEntryLifecycle: jest.Mock }
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}))

describe('SavedScreen', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockParams = {}
    useEntryLifecycle.mockReturnValue({ status: 'saved', refresh: jest.fn() })
  })

  it('confirms the save and returns home on Done', () => {
    render(<SavedScreen />)
    expect(screen.getByText('Saved privately')).toBeTruthy()
    fireEvent.press(screen.getByText('Done'))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('shows private synthesis while the local pipeline is pending', () => {
    useEntryLifecycle.mockReturnValue({ status: 'pending', refresh: jest.fn() })
    render(<SavedScreen />)
    expect(screen.getByText('Private synthesis')).toBeTruthy()
    expect(screen.queryByText('Insight ready')).toBeNull()
  })

  it('shows insight ready only for a confirmed local contribution', () => {
    useEntryLifecycle.mockReturnValue({ status: 'ready', refresh: jest.fn() })
    render(<SavedScreen />)
    expect(screen.getByText('Insight ready')).toBeTruthy()
  })

  it('offers a retry when local lifecycle evidence cannot be read', () => {
    const refresh = jest.fn()
    useEntryLifecycle.mockReturnValue({ status: 'retryable', refresh })
    render(<SavedScreen />)
    fireEvent.press(screen.getByTestId('saved-retry'))
    expect(refresh).toHaveBeenCalled()
  })

  it('does not claim an insight when synthesis is unavailable', () => {
    useEntryLifecycle.mockReturnValue({ status: 'unavailable', refresh: jest.fn() })
    render(<SavedScreen />)
    expect(screen.queryByText('Insight ready')).toBeNull()
  })

  it('passes only the opaque entry id to the lifecycle hook', () => {
    mockParams = { id: 'entry-1', mood: '4' }
    render(<SavedScreen />)
    expect(useEntryLifecycle).toHaveBeenCalledWith('entry-1')
  })

  it('keeps Done available while synthesis is pending', () => {
    useEntryLifecycle.mockReturnValue({ status: 'pending', refresh: jest.fn() })
    render(<SavedScreen />)
    fireEvent.press(screen.getByText('Done'))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('offers a breather when the saved mood was low', () => {
    mockParams = { mood: '2' }
    render(<SavedScreen />)
    fireEvent.press(screen.getByTestId('saved-breathe'))
    expect(mockReplace).toHaveBeenCalledWith('/breathe')
  })

  it('does not offer a breather on a good day', () => {
    mockParams = { mood: '4' }
    render(<SavedScreen />)
    expect(screen.queryByTestId('saved-breathe')).toBeNull()
  })
})
