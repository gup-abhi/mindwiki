import { render, screen } from '@testing-library/react-native'

import EntryDetailScreen from '@/app/entries/[id]'
import { type Entry } from '@/services/storage/entries'

const mockUseEntry = jest.fn()
const mockBack = jest.fn()
jest.mock('@/hooks/useEntries', () => ({ useEntry: () => mockUseEntry() }))
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ id: 'e1' }),
}))

const entry: Entry = {
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
  tagged_at: 1,
}

describe('EntryDetailScreen', () => {
  beforeEach(() => mockUseEntry.mockReset())

  it('renders the entry fields and tags', () => {
    mockUseEntry.mockReturnValue({ entry, loading: false })
    render(<EntryDetailScreen />)
    expect(screen.getByText('a tense meeting')).toBeTruthy()
    expect(screen.getByText('I will mess this up')).toBeTruthy()
    expect(screen.getByText('left early')).toBeTruthy()
    expect(screen.getByText(/Mood: 2\/5/)).toBeTruthy()
    expect(screen.getByText(/anxiety · catastrophizing · mood 0.2/)).toBeTruthy()
  })

  it('shows a not-found state when the entry is missing', () => {
    mockUseEntry.mockReturnValue({ entry: null, loading: false })
    render(<EntryDetailScreen />)
    expect(screen.getByText(/couldn’t be found/)).toBeTruthy()
  })
})
