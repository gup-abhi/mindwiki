import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Home from '@/app/(tabs)/index'
import { listEntries } from '@/services/storage/entries'
import { type WikiPage } from '@/services/storage/wiki'
import { useWikiStore } from '@/store/wiki.store'
import { ok } from '@/types/result'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/storage/entries', () => ({
  listEntries: jest.fn(),
  listStreakTimestamps: jest.fn(() => Promise.resolve({ success: true, data: [] })),
}))
jest.mock('@/services/storage/streak-freezes', () => ({
  listFrozenDays: jest.fn(() => Promise.resolve({ success: true, data: new Set() })),
  freezeDays: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
jest.mock('@/hooks/useRecoverySetup', () => ({
  useRecoverySetup: () => ({
    needsSetup: false,
    phrase: null,
    busy: false,
    error: null,
    setup: jest.fn(),
    done: jest.fn(),
  }),
}))
jest.mock('@/hooks/useModelDownload', () => ({
  useModelDownload: () => ({ ready: true, downloading: false, progress: 1, error: null, download: jest.fn() }),
}))

const mockWiki = jest.fn(() => ({ pages: [] as WikiPage[], loading: false }))
jest.mock('@/services/wiki/engine', () => ({ lineageForEntry: jest.fn() }))
const mockLineage = jest.mocked(require('@/services/wiki/engine').lineageForEntry)
jest.mock('@/hooks/useWiki', () => ({ useWikiPages: () => mockWiki() }))

const mockChallengeCheckIn = jest.fn()
const mockChallenge = jest.fn(() => ({
  challenge: null as { id: string; title: string; target_days: number } | null,
  streak: 0,
  doneToday: false,
  checkIn: mockChallengeCheckIn,
}))
jest.mock('@/hooks/useChallenge', () => ({ useChallenge: () => mockChallenge() }))

const mockList = listEntries as jest.Mock

const entry = (over = {}) => ({
  id: 'a',
  created_at: 1,
  mood: 2,
  situation: 'a tense meeting',
  thought: 'I will fail',
  behavior: null,
  closing_note: null,
  emotion: null,
  distortion: null,
  mood_score: null,
  tagged_at: null,
  ...over,
})

describe('Home entries list', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockPush.mockReset()
    mockWiki.mockReturnValue({ pages: [], loading: false })
    mockChallengeCheckIn.mockReset()
    mockChallenge.mockReturnValue({ challenge: null, streak: 0, doneToday: false, checkIn: mockChallengeCheckIn })
    mockLineage.mockResolvedValue({ success: true, data: [] })
    useWikiStore.setState({ pending: 0 })
  })

  it('opens an entry for reading when its row is tapped', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    fireEvent.press(screen.getByText('a tense meeting'))
    expect(mockPush).toHaveBeenCalledWith('/entries/a')
  })

  it('filters the timeline by emotion, and clears back to all', async () => {
    mockList.mockResolvedValue(
      ok([
        entry({ id: 'a', situation: 'anxious meeting', emotion: 'Anxiety' }),
        entry({ id: 'b', situation: 'joyful walk', emotion: 'Joy' }),
      ])
    )
    render(<Home />)
    await waitFor(() => expect(screen.getByText('joyful walk')).toBeTruthy())

    fireEvent.press(screen.getByTestId('filter-Anxiety'))
    expect(screen.getByText('anxious meeting')).toBeTruthy()
    expect(screen.queryByText('joyful walk')).toBeNull()

    fireEvent.press(screen.getByTestId('filter-all'))
    expect(screen.getByText('joyful walk')).toBeTruthy()
  })

  it('filters the timeline inline from the search field', async () => {
    mockList.mockResolvedValue(
      ok([
        entry({ id: 'a', situation: 'anxious meeting', thought: 'x' }),
        entry({ id: 'b', situation: 'joyful walk', thought: 'y' }),
      ])
    )
    render(<Home />)
    await waitFor(() => expect(screen.getByText('joyful walk')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-search'))
    fireEvent.changeText(screen.getByTestId('home-search-input'), 'anxious')
    expect(screen.getByText('anxious meeting')).toBeTruthy()
    expect(screen.queryByText('joyful walk')).toBeNull()
  })

  it('renders a tagged entry with its emotion and topic', async () => {
    mockList.mockResolvedValue(
      ok([entry({ emotion: 'anxiety', distortion: 'catastrophizing', topic: 'Work', mood_score: 0.2 })])
    )
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    expect(screen.getByText('anxiety · Work')).toBeTruthy()
  })

  it('shows "tagging…" for an entry not yet tagged', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('tagging…')).toBeTruthy())
  })

  it('shows the synthesizing indicator while wiki synthesis is pending', async () => {
    mockList.mockResolvedValue(ok([]))
    useWikiStore.setState({ pending: 1 })
    render(<Home />)
    await waitFor(() => expect(screen.getByText('Synthesizing your insights…')).toBeTruthy())
  })

  it('shows the weekly digest card once enough recent entries exist', async () => {
    const recent = Array.from({ length: 7 }, (_, i) =>
      entry({ id: `e${i}`, created_at: Date.now() - i * 3_600_000 })
    )
    mockList.mockResolvedValue(ok(recent))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('Your weekly digest is ready')).toBeTruthy())
  })

  it('hides the digest card with too few entries', async () => {
    mockList.mockResolvedValue(ok([entry({ created_at: Date.now() })]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    expect(screen.queryByText('Your weekly digest is ready')).toBeNull()
  })

  it('shows the active challenge card with progress and wires the check-in', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    mockChallenge.mockReturnValue({
      challenge: { id: 'c1', title: 'Work out every day', target_days: 30 },
      streak: 4,
      doneToday: false,
      checkIn: mockChallengeCheckIn,
    })
    render(<Home />)
    await waitFor(() => expect(screen.getByText('Work out every day')).toBeTruthy())
    expect(screen.getByText('🔥 Day 4 of 30')).toBeTruthy()

    fireEvent.press(screen.getByTestId('home-challenge-checkin'))
    expect(mockChallengeCheckIn).toHaveBeenCalled()
  })

  it('shows "done for today" instead of the button once checked in', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    mockChallenge.mockReturnValue({
      challenge: { id: 'c1', title: 'Work out every day', target_days: 30 },
      streak: 4,
      doneToday: true,
      checkIn: mockChallengeCheckIn,
    })
    render(<Home />)
    await waitFor(() => expect(screen.getByText(/Done for today/)).toBeTruthy())
    expect(screen.queryByTestId('home-challenge-checkin')).toBeNull()
  })

  it('opens the entry composer from the floating button', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    fireEvent.press(screen.getByTestId('home-new-entry'))
    expect(mockPush).toHaveBeenCalledWith('/entry')
  })
})
