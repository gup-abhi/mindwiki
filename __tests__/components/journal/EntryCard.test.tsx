import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

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
    expect(screen.getByText('A thought without situation', { includeHiddenElements: true })).toBeTruthy()
    expect(screen.getByRole('button').props.accessibilityLabel).toBe('Open journal entry')
    expect(screen.getByRole('button').props.accessibilityLabel).not.toContain('A thought without situation')
    fireEvent.press(screen.getByRole('button'))
    expect(onPress).toHaveBeenCalled()
  })

  it('keeps the entry preview in the accessibility tree without putting it in a control label', () => {
    render(<EntryCard entry={make({ situation: 'A private situation' })} onPress={jest.fn()} />)
    const preview = screen.getByText('A private situation')
    expect(preview.props.importantForAccessibility).not.toBe('no-hide-descendants')
    expect(screen.getAllByRole('button').every((node) => !node.props.accessibilityLabel?.includes('A private situation'))).toBe(true)
  })

  it('shows mood-only fallback and de-duplicates metadata', () => {
    render(<EntryCard entry={make({ named_emotion: 'Calm', emotion: 'calm', topic: 'Work', topic2: 'Work', tagged_at: 1 })} onPress={jest.fn()} />)
    expect(screen.getByText('Mood check-in · Good')).toBeTruthy()
    expect(screen.queryByText('Good · Calm · Work · Work')).toBeNull()
  })

  it('keeps derived metadata out of the entry control label', () => {
    render(<EntryCard entry={make({ named_emotion: 'Calm', emotion: 'anxious', distortion: 'Mind reading', topic: 'Work', topic2: 'Family', tagged_at: 1 })} onPress={jest.fn()} />)
    expect(screen.getByRole('button').props.accessibilityLabel).toBe('Open journal entry')
  })

  it('keeps derived themes visible as content while using an opaque test id', () => {
    render(<EntryCard entry={make({ situation: 'A situation', topic: 'Private theme', tagged_at: 1 })} onPress={jest.fn()} />)
    expect(screen.getByText('Good · Private theme')).toBeTruthy()
  })

  it('handles a stationary Android release when native onPress is dropped after scrolling', () => {
    const originalOS = Platform.OS
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
    const onPress = jest.fn()
    render(<EntryCard entry={make({ id: 'entry-after-scroll' })} onPress={onPress} />)
    const button = screen.getByRole('button')

    fireEvent(button, 'pressIn', { nativeEvent: { pageX: 20, pageY: 200 } })
    fireEvent(button, 'pressOut', { nativeEvent: { pageX: 20, pageY: 200 } })
    fireEvent.press(button)

    expect(onPress).toHaveBeenCalledTimes(1)
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS })
  })

  it('does not open an entry after the touch moves like a scroll', () => {
    const originalOS = Platform.OS
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
    const onPress = jest.fn()
    render(<EntryCard entry={make({ id: 'entry-during-scroll' })} onPress={onPress} />)
    const button = screen.getByRole('button')

    fireEvent(button, 'pressIn', { nativeEvent: { pageX: 20, pageY: 200 } })
    fireEvent(button, 'touchMove', { nativeEvent: { pageX: 20, pageY: 220 } })
    fireEvent(button, 'pressOut', { nativeEvent: { pageX: 20, pageY: 220 } })

    expect(onPress).not.toHaveBeenCalled()
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS })
  })
})
