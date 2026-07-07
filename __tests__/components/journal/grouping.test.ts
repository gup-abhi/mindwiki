import { groupEntriesByDay } from '@/components/journal/grouping'
import { type Entry } from '@/services/storage/entries'

// A 9am entry on the given local date, with a stable id.
const entry = (id: string, year: number, month: number, day: number, hour = 9): Entry => ({
  id,
  created_at: new Date(year, month, day, hour, 0).getTime(),
  mood: 3,
  situation: `situation ${id}`,
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
})

const NOW = new Date(2026, 5, 20, 14, 0).getTime() // Sat Jun 20 2026, 2pm

describe('groupEntriesByDay', () => {
  it('returns no sections for an empty list', () => {
    expect(groupEntriesByDay([], NOW)).toEqual([])
  })

  it('labels the current and prior day relatively, older days by date', () => {
    const sections = groupEntriesByDay(
      [
        entry('a', 2026, 5, 20), // today
        entry('b', 2026, 5, 19), // yesterday
        entry('c', 2026, 5, 16), // older, same year
      ],
      NOW
    )
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Yesterday', expect.any(String)])
    expect(sections[2].title).not.toBe('Today')
    expect(sections[2].title).not.toBe('Yesterday')
    expect(sections[2].title).toMatch(/Jun 16/)
  })

  it('collapses multiple entries on the same day into one section, order preserved', () => {
    const sections = groupEntriesByDay(
      [entry('a', 2026, 5, 20, 21), entry('b', 2026, 5, 20, 9)],
      NOW
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('Today')
    expect(sections[0].data.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('includes the year for entries from a different year', () => {
    const sections = groupEntriesByDay([entry('old', 2025, 11, 25)], NOW)
    expect(sections[0].title).toMatch(/2025/)
  })
})
