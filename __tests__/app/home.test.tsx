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
jest.mock('@/services/storage/entries', () => ({ listEntries: jest.fn() }))
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
jest.mock('@/hooks/useWiki', () => ({ useWikiPages: () => mockWiki() }))

const mockOpenCheckin = jest.fn()
const mockDismissCheckin = jest.fn()
const mockCheckin = jest.fn(() => ({
  checkin: null as { id: string; checkin_question: string } | null,
  open: mockOpenCheckin,
  dismiss: mockDismissCheckin,
}))
jest.mock('@/hooks/usePursuitCheckin', () => ({ usePursuitCheckin: () => mockCheckin() }))

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
    mockOpenCheckin.mockReset()
    mockDismissCheckin.mockReset()
    mockCheckin.mockReturnValue({ checkin: null, open: mockOpenCheckin, dismiss: mockDismissCheckin })
    useWikiStore.setState({ pending: 0 })
  })

  it('opens an entry for reading when its row is tapped', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    fireEvent.press(screen.getByText('a tense meeting'))
    expect(mockPush).toHaveBeenCalledWith('/entries/a')
  })

  it('renders a tagged entry with its emotion/distortion', async () => {
    mockList.mockResolvedValue(
      ok([entry({ emotion: 'anxiety', distortion: 'catastrophizing', mood_score: 0.2 })])
    )
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    expect(screen.getByText('anxiety · catastrophizing · mood 0.2')).toBeTruthy()
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
    await waitFor(() => expect(screen.getByText('Synthesizing your wiki…')).toBeTruthy())
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

  it('shows the check-in card and wires its actions when a pursuit is due', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    mockCheckin.mockReturnValue({
      checkin: { id: 'p1', checkin_question: 'How is the marathon training going?' },
      open: mockOpenCheckin,
      dismiss: mockDismissCheckin,
    })
    render(<Home />)

    await waitFor(() =>
      expect(screen.getByText('How is the marathon training going?')).toBeTruthy()
    )
    expect(screen.getByText('Checking in')).toBeTruthy()

    fireEvent.press(screen.getByTestId('checkin-open'))
    expect(mockOpenCheckin).toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('checkin-dismiss'))
    expect(mockDismissCheckin).toHaveBeenCalled()
  })

  it('hides the check-in card when nothing is due', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    render(<Home />)
    await waitFor(() => expect(screen.getByText('a tense meeting')).toBeTruthy())
    expect(screen.queryByText('Checking in')).toBeNull()
  })

  it('surfaces a proactive question from the richest wiki page', async () => {
    mockList.mockResolvedValue(ok([entry()]))
    mockWiki.mockReturnValue({
      pages: [
        {
          id: 'p1',
          title: 'Work',
          category: null,
          content: '',
          entry_count: 5,
          version: 1,
          version_history: [],
          created_at: 0,
          updated_at: 0,
        },
      ],
      loading: false,
    })
    render(<Home />)
    await waitFor(() => expect(screen.getByText('Curious?')).toBeTruthy())
    expect(screen.getByText(/Work/)).toBeTruthy()
  })
})
