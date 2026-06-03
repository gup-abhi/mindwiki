import { render, screen, fireEvent } from '@testing-library/react-native'

import QueryScreen from '@/app/query'
import { type WikiAnswer } from '@/services/wiki/query'

const mockUse = jest.fn()
const mockPush = jest.fn()
const mockAsk = jest.fn()
jest.mock('@/hooks/useWikiQuery', () => ({ useWikiQuery: () => mockUse() }))
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}))

const page = (id: string, title: string) => ({
  id,
  title,
  category: null,
  content: '',
  entry_count: 1,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
})

const entry = (id: string, situation: string, created_at = 0) => ({
  id,
  created_at,
  mood: 3,
  situation,
  thought: 't',
  behavior: null,
  closing_note: null,
  emotion: null,
  distortion: null,
  mood_score: null,
  tagged_at: null,
})

const base = {
  suggestions: ['What patterns show up around Work?'],
  recentPages: [page('p1', 'Work')],
  answer: null as WikiAnswer | null,
  related: [] as ReturnType<typeof entry>[],
  asking: false,
  ask: mockAsk,
}

describe('QueryScreen', () => {
  beforeEach(() => {
    mockUse.mockReset()
    mockPush.mockReset()
    mockAsk.mockReset()
  })

  it('shows suggestions and asks when one is tapped', () => {
    mockUse.mockReturnValue(base)
    render(<QueryScreen />)
    const suggestion = screen.getByText('What patterns show up around Work?')
    fireEvent.press(suggestion)
    expect(mockAsk).toHaveBeenCalledWith('What patterns show up around Work?')
  })

  it('renders the answer with evidence and source chips', () => {
    mockUse.mockReturnValue({
      ...base,
      answer: {
        answer: 'Deadlines tend to spike it.',
        sources: [page('p1', 'Work'), page('p2', 'Sleep')],
        evidenceCount: 6,
      },
    })
    render(<QueryScreen />)
    expect(screen.getByText('Deadlines tend to spike it.')).toBeTruthy()
    expect(screen.getByText(/Drawn from 2 pages · 6 entries/)).toBeTruthy()
    expect(screen.getByText('Explore in graph →')).toBeTruthy()

    fireEvent.press(screen.getByText('Work'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')
  })

  it('lists related entries and opens one for reading', () => {
    mockUse.mockReturnValue({
      ...base,
      answer: { answer: 'A.', sources: [], evidenceCount: 0 },
      related: [entry('en1', 'a tense meeting', 1)],
    })
    render(<QueryScreen />)
    expect(screen.getByText('Entries behind this')).toBeTruthy()
    fireEvent.press(screen.getByText('a tense meeting'))
    expect(mockPush).toHaveBeenCalledWith('/entries/en1')
  })
})
