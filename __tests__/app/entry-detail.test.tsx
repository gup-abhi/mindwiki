import { fireEvent, render, screen } from '@testing-library/react-native'

import EntryDetailScreen from '@/app/entries/[id]'
import { type Entry } from '@/services/storage/entries'

const mockUseEntry = jest.fn()
const mockUseEntries = jest.fn()
const mockBack = jest.fn()
const mockReplace = jest.fn()
jest.mock('@/hooks/useEntries', () => ({
  useEntry: () => mockUseEntry(),
  useEntries: () => mockUseEntries(),
}))
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
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
    mockReplace.mockReset()
    mockUseEntries.mockReturnValue({ entries: [entry] })
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

  it('shows a not-found state when the entry is missing', () => {
    mockUseEntry.mockReturnValue({ entry: null, loading: false })
    render(<EntryDetailScreen />)
    expect(screen.getByText(/couldn’t be found/)).toBeTruthy()
  })
})
