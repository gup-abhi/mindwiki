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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockProcessEntry = require('@/services/pipeline').processEntry as jest.Mock

describe('EntryScreen (5-step flow)', () => {
  beforeEach(() => {
    useEntryStore.getState().reset()
    mockReplace.mockReset()
    mockCreateEntry.mockReset()
    mockCreateEntry.mockResolvedValue(ok({ id: 'e1' }))
    mockProcessEntry.mockReset()
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 0, confidence: 0, keywordMatch: false },
    })
  })

  function fillAndSave() {
    fireEvent.press(screen.getByText('4'))
    fireEvent.press(screen.getByText('Next'))
    fireEvent.changeText(screen.getByPlaceholderText('Describe the situation…'), 'a meeting')
    fireEvent.press(screen.getByText('Next'))
    fireEvent.changeText(screen.getByPlaceholderText('The automatic thought…'), 'I will fail')
    fireEvent.press(screen.getByText('Next'))
    fireEvent.press(screen.getByText('Skip'))
    fireEvent.press(screen.getByText('Save entry'))
  }

  it('walks all 5 steps (with a skip) and submits the built entry', async () => {
    render(<EntryScreen />)

    fireEvent.press(screen.getByText('4')) // mood
    fireEvent.press(screen.getByText('Next')) // -> step 2

    fireEvent.changeText(screen.getByPlaceholderText('Describe the situation…'), 'a meeting')
    fireEvent.press(screen.getByText('Next')) // -> step 3

    fireEvent.changeText(screen.getByPlaceholderText('The automatic thought…'), 'I will fail')
    fireEvent.press(screen.getByText('Next')) // -> step 4

    fireEvent.press(screen.getByText('Skip')) // -> step 5 (behavior skipped)
    fireEvent.press(screen.getByText('Save entry'))

    await waitFor(() =>
      expect(mockCreateEntry).toHaveBeenCalledWith({
        mood: 4,
        situation: 'a meeting',
        thought: 'I will fail',
        behavior: null,
        closing_note: null,
      })
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/saved'))
  })

  it('does not advance from step 1 until a mood is chosen', () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByText('Next'))
    // still on step 1 — the situation field has not appeared
    expect(screen.queryByPlaceholderText('Describe the situation…')).toBeNull()
  })

  it('goes back to a previous step', () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByText('3'))
    fireEvent.press(screen.getByText('Next')) // -> step 2
    expect(screen.getByPlaceholderText('Describe the situation…')).toBeTruthy()
    fireEvent.press(screen.getByText('Back')) // -> step 1
    expect(screen.getByText('Awful')).toBeTruthy()
  })

  it('routes to the crisis screen when a crisis tier is detected', async () => {
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 3, confidence: 0.9, keywordMatch: true },
    })
    render(<EntryScreen />)
    fillAndSave()
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/crisis', params: { tier: '3' } })
    )
  })
})
