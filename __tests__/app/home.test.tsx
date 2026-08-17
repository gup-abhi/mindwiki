import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Home from '@/app/(tabs)/index'
import { listEntries } from '@/services/storage/entries'
import { type WikiPage } from '@/services/storage/wiki'
import { useWikiStore } from '@/store/wiki.store'
import { ok } from '@/types/result'

const mockPush = jest.fn()
const mockStreakTimestamps = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/storage/entries', () => ({
  listEntries: jest.fn(),
  countJournalEntries: jest.fn(() => Promise.resolve({ success: true, data: 0 })),
  listStreakTimestamps: jest.fn(() => Promise.resolve({ success: true, data: [] })),
}))
jest.mock('@/services/storage/streak-freezes', () => ({
  listFrozenDays: jest.fn(() => Promise.resolve({ success: true, data: new Set() })),
  freezeDays: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
jest.mock('@/hooks/useStreakTimestamps', () => ({
  useStreakTimestamps: () => mockStreakTimestamps(),
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
const mockCount = jest.mocked(require('@/services/storage/entries').countJournalEntries)

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

describe('Home dashboard', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockCount.mockReset()
    mockCount.mockResolvedValue(ok(0))
    mockPush.mockReset()
    mockWiki.mockReturnValue({ pages: [], loading: false })
    mockChallengeCheckIn.mockReset()
    mockStreakTimestamps.mockReset().mockReturnValue({ timestamps: [], refresh: jest.fn() })
    mockChallenge.mockReturnValue({ challenge: null, streak: 0, doneToday: false, checkIn: mockChallengeCheckIn })
    mockLineage.mockResolvedValue({ success: true, data: [] })
    useWikiStore.setState({ pending: 0 })
  })

  it('renders Today, recent entries, and Browse & search action', async () => {
    mockCount.mockResolvedValue(ok(4))
    mockList.mockResolvedValue(ok([entry(), entry({ id: 'b' }), entry({ id: 'c' }), entry({ id: 'd' })]))
    render(<Home />)
    await waitFor(() => expect(screen.getAllByText('a tense meeting', { includeHiddenElements: true })).toHaveLength(3))
    const entryButtons = screen.getAllByRole('button')
    expect(entryButtons.every((node) => !node.props.accessibilityLabel?.includes('a tense meeting'))).toBe(true)
    expect(screen.queryByText('Today')).toBeNull()
    expect(screen.getByTestId('home-view-all')).toBeTruthy()
    expect(screen.getByText('Browse & search')).toBeTruthy()
    expect(screen.getByText('4 journal entries')).toBeTruthy()
  })

  it('opens an entry for reading when its row is tapped', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting', { includeHiddenElements: true })).toBeTruthy())
    fireEvent.press(screen.getByText('a tense meeting', { includeHiddenElements: true }))
    expect(mockPush).toHaveBeenCalledWith('/entries/a')
  })



  it('renders a tagged entry with its emotion and topic', async () => {
    mockList.mockResolvedValue(
      ok([entry({ emotion: 'anxiety', distortion: 'catastrophizing', topic: 'Work', mood_score: 0.2 })])
    )
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting', { includeHiddenElements: true })).toBeTruthy())
    expect(screen.getByText('Low · anxiety · catastrophizing · Work')).toBeTruthy()
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
    await waitFor(() => expect(screen.getByText('Private synthesis in progress')).toBeTruthy())
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
    await waitFor(() => expect(screen.getByText('a tense meeting', { includeHiddenElements: true })).toBeTruthy())
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

  it('distinguishes a completed guided reflection from an empty journal', async () => {
    mockCount.mockResolvedValue(ok(0))
    mockList.mockResolvedValue(ok([]))
    mockStreakTimestamps.mockReturnValue({ timestamps: [Date.now()], refresh: jest.fn() })
    render(<Home />)
    await waitFor(() => expect(screen.getByText('Your guided reflection is saved')).toBeTruthy())
    expect(screen.getByText(/Your journal is still empty/)).toBeTruthy()
  })

  it('keeps the ordinary empty state for a new user', async () => {
    mockCount.mockResolvedValue(ok(0))
    mockList.mockResolvedValue(ok([]))
    mockStreakTimestamps.mockReturnValue({ timestamps: [], refresh: jest.fn() })
    render(<Home />)
    await waitFor(() => expect(screen.getByText('No entries yet')).toBeTruthy())
    expect(screen.getByText('Start with how you feel.')).toBeTruthy()
  })

  it('opens archive from View all and composer from New entry', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting', { includeHiddenElements: true })).toBeTruthy())
    fireEvent.press(screen.getByTestId('home-view-all'))
    expect(mockPush).toHaveBeenCalledWith('/entries')
  })

  it('keeps Home focused on capture and recent continuity', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting', { includeHiddenElements: true })).toBeTruthy())

    expect(screen.getByText('Recent entries')).toBeTruthy()
    expect(screen.queryByText('Guided reflection')).toBeNull()
    expect(screen.queryByText('Untangle a thought')).toBeNull()
    expect(screen.queryByTestId('home-action-guided-reflection')).toBeNull()
    expect(screen.queryByTestId('home-action-untangle')).toBeNull()
    expect(screen.queryByTestId('streak-rescue')).toBeNull()

    const newEntry = screen.getByTestId('home-new-entry')
    const browse = screen.getByTestId('home-view-all')
    expect(newEntry.props.accessibilityLabel).toBe('New entry')
    expect(browse.props.accessibilityLabel).toBe('Browse & search')
    expect(browse.props.accessibilityState?.disabled).toBe(false)

    fireEvent.press(newEntry)
    expect(mockPush).toHaveBeenCalledWith('/entry')
  })
})
