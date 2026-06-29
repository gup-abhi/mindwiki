import { fireEvent, render, screen } from '@testing-library/react-native'

import EntryDetailScreen from '@/app/entries/[id]'
import { type Entry } from '@/services/storage/entries'

const mockUseEntry = jest.fn()
const mockUseEntries = jest.fn()
const mockUseLineage = jest.fn()
const mockBack = jest.fn()
const mockReplace = jest.fn()
const mockPush = jest.fn()
jest.mock('@/hooks/useEntries', () => ({
  useEntry: () => mockUseEntry(),
  useEntries: () => mockUseEntries(),
}))
jest.mock('@/hooks/useWiki', () => ({ useEntryLineage: () => mockUseLineage() }))
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => ({ id: 'e1' }),
}))

const make = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: new Date(2026, 5, 1, 9, 30).getTime(),
  mood: 2,
  situation: 'a tense meeting',
  thought: 'I will mess this up',
  behavior: 'left early',
  closing_note: null,
  emotion: 'anxiety',
  named_emotion: null,
  energy: null,
  distortion: 'catastrophizing',
  mood_score: 0.2,
  topic: 'Work',
  tagged_at: 1,
  source: 'journal',
  ...over,
})

const entry = make()

describe('EntryDetailScreen', () => {
  beforeEach(() => {
    mockUseEntry.mockReset()
    mockUseEntries.mockReset()
    mockUseLineage.mockReset()
    mockReplace.mockReset()
    mockPush.mockReset()
    mockUseEntries.mockReturnValue({ entries: [entry] })
    mockUseLineage.mockReturnValue([])
  })

  it('renders the entry prose, mood label and tags', () => {
    mockUseEntry.mockReturnValue({ entry, loading: false })
    render(<EntryDetailScreen />)
    expect(screen.getByText('a tense meeting')).toBeTruthy()
    expect(screen.getByText('I will mess this up')).toBeTruthy()
    expect(screen.getByText('left early')).toBeTruthy()
    expect(screen.getByText('Low')).toBeTruthy() // mood 2 → "Low"
    // tags render as separate pills (no raw mood_score / "none")
    expect(screen.getByText('anxiety')).toBeTruthy()
    expect(screen.getByText('catastrophizing')).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
  })

  it('navigates to the older neighbour and disables Newer at the newest entry', () => {
    const newest = make({ id: 'e1', created_at: 200 })
    const older = make({ id: 'e0', created_at: 100 })
    mockUseEntry.mockReturnValue({ entry: newest, loading: false })
    mockUseEntries.mockReturnValue({ entries: [newest, older] }) // newest-first

    render(<EntryDetailScreen />)
    fireEvent.press(screen.getByText('← Older'))
    expect(mockReplace).toHaveBeenCalledWith('/entries/e0')

    // e1 is the newest, so Newer is a no-op
    fireEvent.press(screen.getByText('Newer →'))
    expect(mockReplace).toHaveBeenCalledTimes(1)
  })

  it('makes a tag that grew into a page tappable, opening the page', () => {
    mockUseEntry.mockReturnValue({ entry, loading: false })
    // 'Anxiety' matches the entry's emotion tag — so the tag itself becomes the
    // link (no separate "Shaped these pages" list duplicating it).
    mockUseLineage.mockReturnValue([{ id: 'p1', title: 'Anxiety', category: 'emotion' }])

    render(<EntryDetailScreen />)
    expect(screen.queryByText('Shaped these pages')).toBeNull()
    expect(screen.getByText('Tap a highlighted tag to open the page it shaped.')).toBeTruthy()
    fireEvent.press(screen.getByText('anxiety ›'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')
  })

  it('surfaces a shaped page that is not one of the entry tags', () => {
    mockUseEntry.mockReturnValue({ entry, loading: false })
    mockUseLineage.mockReturnValue([{ id: 'p9', title: 'Mom', category: 'person' }])

    render(<EntryDetailScreen />)
    fireEvent.press(screen.getByText('Mom ›'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p9')
  })

  it('deep-links into the graph focused on the entry’s primary concept (topic)', () => {
    mockUseEntry.mockReturnValue({ entry, loading: false })
    render(<EntryDetailScreen />)
    fireEvent.press(screen.getByTestId('entry-graph-link'))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/graph', params: { focus: 'Work' } })
  })

  it('falls back to the emotion for the graph link when there is no topic', () => {
    mockUseEntry.mockReturnValue({ entry: make({ topic: null }), loading: false })
    render(<EntryDetailScreen />)
    fireEvent.press(screen.getByTestId('entry-graph-link'))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/graph', params: { focus: 'anxiety' } })
  })

  it('shows a not-found state when the entry is missing', () => {
    mockUseEntry.mockReturnValue({ entry: null, loading: false })
    render(<EntryDetailScreen />)
    expect(screen.getByText(/couldn’t be found/)).toBeTruthy()
  })
})
