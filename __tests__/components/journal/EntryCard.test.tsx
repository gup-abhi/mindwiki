import { fireEvent, render, screen } from '@testing-library/react-native'

import { EntryCard } from '@/components/journal/EntryCard'
import { type Entry } from '@/services/storage/entries'

const make = (over: Partial<Entry> = {}): Entry => ({
  id: 'entry-1',
  created_at: 1,
  mood: 4,
  situation: '',
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

describe('EntryCard', () => {
  it('uses thought fallback and exposes a useful accessibility label', () => {
    const onPress = jest.fn()
    render(<EntryCard entry={make({ thought: 'A thought without situation' })} onPress={onPress} />)
    expect(screen.getByText('A thought without situation')).toBeTruthy()
    expect(screen.getByRole('button').props.accessibilityLabel).toContain('Good')
    fireEvent.press(screen.getByRole('button'))
    expect(onPress).toHaveBeenCalled()
  })

  it('shows mood-only fallback and de-duplicates metadata', () => {
    render(<EntryCard entry={make({ named_emotion: 'Calm', emotion: 'calm', topic: 'Work', topic2: 'Work', tagged_at: 1 })} onPress={jest.fn()} />)
    expect(screen.getByText('Mood check-in · Good')).toBeTruthy()
    expect(screen.queryByText('Good · Calm · Work · Work')).toBeNull()
  })
})