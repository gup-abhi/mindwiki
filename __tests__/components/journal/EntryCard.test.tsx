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
