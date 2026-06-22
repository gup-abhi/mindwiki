import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'

import EntryScreen from '@/app/entry'
import { useEntryStore } from '@/store/entry.store'
import { createEntry } from '@/services/storage/entries'
import { ok } from '@/types/result'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}))
jest.mock('@/services/storage/entries', () => ({ createEntry: jest.fn() }))
jest.mock('@/services/pipeline', () => ({ processEntry: jest.fn() }))
jest.mock('@/services/notifications/scheduler', () => ({ onEntrySaved: jest.fn() }))

const mockCreateEntry = createEntry as jest.Mock
const mockProcessEntry = require('@/services/pipeline').processEntry as jest.Mock

describe('EntryScreen (free-write)', () => {
  beforeEach(() => {
    useEntryStore.getState().reset()
    mockReplace.mockReset()
    mockCreateEntry.mockReset()
    // Echo the saved fields back (incl. mood) like the real createEntry does.
    mockCreateEntry.mockImplementation((input) => Promise.resolve(ok({ id: 'e1', ...input })))
    mockProcessEntry.mockReset()
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 0, confidence: 0, keywordMatch: false },
    })
  })

  it('saves a free-write entry, mapping the body to situation', async () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('mood-4'))
    fireEvent.changeText(screen.getByTestId('entry-body'), 'a rough day at work')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockCreateEntry).toHaveBeenCalledWith({
        mood: 4,
        situation: 'a rough day at work',
        thought: '',
        behavior: null,
        closing_note: null,
      })
    )
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/saved', params: { mood: '4' } })
    )
  })

  it('does not save without a mood and body', () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('entry-save')) // disabled — no-op
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('reveals the optional thought field and includes it on save', async () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('mood-3'))
    fireEvent.changeText(screen.getByTestId('entry-body'), 'snapped at Sarah')
    fireEvent.press(screen.getByTestId('entry-add-thought'))
    fireEvent.changeText(screen.getByTestId('entry-thought'), 'I ruin everything')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockCreateEntry).toHaveBeenCalledWith({
        mood: 3,
        situation: 'snapped at Sarah',
        thought: 'I ruin everything',
        behavior: null,
        closing_note: null,
      })
    )
  })

  it('routes to the crisis screen when a confident crisis tier is detected', async () => {
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 3, confidence: 0.9, keywordMatch: true },
    })
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('mood-1'))
    fireEvent.changeText(screen.getByTestId('entry-body'), 'i give up')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/crisis', params: { tier: '3' } })
    )
  })

  it('does NOT open the crisis screen for a low-confidence tier-1 signal — saves normally', async () => {
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 1, confidence: 0.35, keywordMatch: false },
    })
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('mood-2'))
    fireEvent.changeText(screen.getByTestId('entry-body'), 'I will mess up the presentation')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/saved', params: { mood: '2' } })
    )
    expect(mockReplace).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/crisis' })
    )
  })
})
