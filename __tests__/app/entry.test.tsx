import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import { Alert } from 'react-native'

import EntryScreen from '@/app/entry'
import { useEntryStore } from '@/store/entry.store'
import { createEntry } from '@/services/storage/entries'
import { ok } from '@/types/result'

type BackCb = (e: { preventDefault: () => void; data: { action: unknown } }) => void
const mockReplace = jest.fn()
const mockAddListener = jest.fn((_event: string, _cb: BackCb) => jest.fn()) // returns an unsubscribe
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))
jest.mock('@/services/storage/entries', () => ({ createEntry: jest.fn() }))
jest.mock('@/services/pipeline', () => ({ processEntry: jest.fn() }))
jest.mock('@/services/notifications/scheduler', () => ({ onEntrySaved: jest.fn() }))
jest.mock('@/services/storage/draft', () => ({
  saveDraft: jest.fn(),
  loadDraft: jest.fn().mockResolvedValue(null),
  clearDraft: jest.fn(),
}))

const mockCreateEntry = createEntry as jest.Mock
const mockProcessEntry = require('@/services/pipeline').processEntry as jest.Mock
const draftMock = require('@/services/storage/draft') as {
  saveDraft: jest.Mock
  loadDraft: jest.Mock
  clearDraft: jest.Mock
}

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
    draftMock.saveDraft.mockClear()
    draftMock.clearDraft.mockClear()
    draftMock.loadDraft.mockReset().mockResolvedValue(null)
    mockAddListener.mockClear() // each test's render is the only back-guard registration
  })

  // Step 1 (grid + feeling) → Continue → step 2 (writing). Advancing requires a
  // grid point and a feeling, since that's what enables Continue.
  const goToWrite = (affect: string, feeling: string) => {
    fireEvent.press(screen.getByTestId(affect))
    fireEvent.press(screen.getByTestId(`feeling-${feeling}`))
    fireEvent.press(screen.getByTestId('entry-continue'))
  }

  it('saves a free-write entry, mapping the body to situation', async () => {
    render(<EntryScreen />)
    goToWrite('affect-4-5', 'Excited') // pleasant + high energy; feeling required
    fireEvent.changeText(screen.getByTestId('entry-body'), 'a rough day at work')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockCreateEntry).toHaveBeenCalledWith({
        mood: 4,
        situation: 'a rough day at work',
        thought: '',
        named_emotion: 'Excited',
        energy: 5,
        behavior: null,
        closing_note: null,
      })
    )
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/saved', params: { id: 'e1', mood: '4' } })
    )
  })

  it('does not advance without a mood or a feeling', () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('entry-continue')) // disabled — no-op
    expect(screen.queryByTestId('entry-body')).toBeNull() // still on step 1
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('opens blank, resetting any leftover store state', () => {
    useEntryStore.getState().setAffect(4, 5) // leftover from a prior screen
    render(<EntryScreen />)
    expect(useEntryStore.getState().draft.mood).toBeNull()
  })

  it('restores a saved draft on open', async () => {
    draftMock.loadDraft.mockResolvedValue({
      mood: 2,
      energy: 4,
      body: 'work in progress',
      thought: '',
      emotion: 'Anxious',
    })
    render(<EntryScreen />)
    await waitFor(() => expect(useEntryStore.getState().draft.mood).toBe(2))
    expect(useEntryStore.getState().draft.emotion).toBe('Anxious')
  })

  it('registers a back guard to offer keeping a draft', () => {
    render(<EntryScreen />)
    expect(mockAddListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function))
  })

  it('clears the persisted draft after a successful save', async () => {
    render(<EntryScreen />)
    goToWrite('affect-4-5', 'Excited')
    fireEvent.press(screen.getByTestId('entry-save'))
    await waitFor(() => expect(draftMock.clearDraft).toHaveBeenCalled())
  })

  // The written text is the only thing worth a draft — a bare grid/feeling pick is not.
  const backGuard = () => mockAddListener.mock.calls.find((c) => c[0] === 'beforeRemove')?.[1]

  it('does not prompt on back when only a grid cell is picked (no text)', () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('affect-4-5'))
    const e = { preventDefault: jest.fn(), data: { action: {} } }
    backGuard()!(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('prompts to keep a draft on back once there is text', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    render(<EntryScreen />)
    goToWrite('affect-4-5', 'Excited')
    fireEvent.changeText(screen.getByTestId('entry-body'), 'something on my mind')
    fireEvent.press(screen.getByTestId('entry-back')) // back to step 1, text retained
    const e = { preventDefault: jest.fn(), data: { action: {} } }
    backGuard()!(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(alertSpy).toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('steps back to the feeling screen instead of leaving, from the writing step', () => {
    render(<EntryScreen />)
    goToWrite('affect-4-5', 'Excited')
    expect(screen.getByTestId('entry-body')).toBeTruthy() // on step 2
    const e = { preventDefault: jest.fn(), data: { action: {} } }
    act(() => backGuard()!(e))
    expect(e.preventDefault).toHaveBeenCalled() // intercepted — returns to step 1
    expect(screen.queryByTestId('entry-body')).toBeNull()
    expect(screen.getByTestId('entry-continue')).toBeTruthy()
  })

  it('offers Clear once something is entered, wiping the store and the persisted draft', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === 'Clear')?.onPress?.())
    render(<EntryScreen />)
    expect(screen.queryByTestId('entry-clear')).toBeNull() // nothing entered yet
    fireEvent.press(screen.getByTestId('affect-4-5'))
    fireEvent.press(screen.getByTestId('entry-clear'))
    expect(useEntryStore.getState().draft.mood).toBeNull()
    expect(draftMock.clearDraft).toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('does not advance with a grid point but no feeling chosen', () => {
    render(<EntryScreen />)
    fireEvent.press(screen.getByTestId('affect-4-5'))
    fireEvent.press(screen.getByTestId('entry-continue')) // still disabled — feeling required
    expect(screen.queryByTestId('entry-body')).toBeNull() // stayed on step 1
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('reveals the optional thought field and includes it on save', async () => {
    render(<EntryScreen />)
    goToWrite('affect-4-2', 'Calm') // pleasant + low energy
    fireEvent.changeText(screen.getByTestId('entry-body'), 'snapped at Sarah')
    fireEvent.press(screen.getByTestId('entry-add-thought'))
    fireEvent.changeText(screen.getByTestId('entry-thought'), 'I ruin everything')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockCreateEntry).toHaveBeenCalledWith({
        mood: 4,
        situation: 'snapped at Sarah',
        thought: 'I ruin everything',
        named_emotion: 'Calm',
        energy: 2,
        behavior: null,
        closing_note: null,
      })
    )
  })

  it('offers feeling words after a grid point is picked and includes the chosen one on save', async () => {
    render(<EntryScreen />)
    // No grid point yet → no feelings offered.
    expect(screen.queryByTestId('entry-feelings')).toBeNull()

    fireEvent.press(screen.getByTestId('affect-4-5'))
    expect(screen.getByTestId('entry-feelings')).toBeTruthy()
    fireEvent.press(screen.getByTestId('feeling-Excited'))
    fireEvent.press(screen.getByTestId('entry-continue'))
    fireEvent.changeText(screen.getByTestId('entry-body'), 'a better day')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ named_emotion: 'Excited', energy: 5 }))
    )
  })

  it('routes to the crisis screen when a confident crisis tier is detected', async () => {
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 3, confidence: 0.9, keywordMatch: true },
    })
    render(<EntryScreen />)
    goToWrite('affect-1-1', 'Sad') // unpleasant + low energy
    fireEvent.changeText(screen.getByTestId('entry-body'), 'i give up')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/crisis',
        params: { tier: '3', conf: '0.9' },
      })
    )
  })

  it('does NOT open the crisis screen for a low-confidence tier-1 signal — saves normally', async () => {
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 1, confidence: 0.35, keywordMatch: false },
    })
    render(<EntryScreen />)
    goToWrite('affect-2-4', 'Anxious') // unpleasant + high energy
    fireEvent.changeText(screen.getByTestId('entry-body'), 'I will mess up the presentation')
    fireEvent.press(screen.getByTestId('entry-save'))

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/saved', params: { id: 'e1', mood: '2' } })
    )
    expect(mockReplace).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/crisis' })
    )
  })
})
