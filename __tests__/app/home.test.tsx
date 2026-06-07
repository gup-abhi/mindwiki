import { render, screen, waitFor } from '@testing-library/react-native'

import Home from '@/app/index'
import { listEntries } from '@/services/storage/entries'
import { type WikiPage } from '@/services/storage/wiki'
import { useWikiStore } from '@/store/wiki.store'
import { ok } from '@/types/result'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
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

const mockWiki = jest.fn(() => ({ pages: [] as WikiPage[], loading: false }))
jest.mock('@/hooks/useWiki', () => ({ useWikiPages: () => mockWiki() }))

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
    mockWiki.mockReturnValue({ pages: [], loading: false })
    useWikiStore.setState({ pending: 0 })
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
