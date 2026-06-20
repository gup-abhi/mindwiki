import { type Entry } from '@/services/storage/entries'

/** A SectionList section: a day heading + that day's entries (newest first). */
export interface EntrySection {
  title: string
  data: Entry[]
}

/** Local-midnight timestamp for a given time. */
function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayTitle(day: number, today: number, yesterday: number): string {
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  const d = new Date(day)
  const sameYear = new Date(today).getFullYear() === d.getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Group an already-sorted (newest-first) entry list into day sections with
 * human headings ("Today", "Yesterday", "Mon, Jun 16"). Pure — `now` is passed
 * in so the relative headings are testable.
 */
export function groupEntriesByDay(entries: Entry[], now: number): EntrySection[] {
  const today = dayStart(now)
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const yesterday = dayStart(y.getTime())

  const sections: EntrySection[] = []
  let currentDay = NaN
  for (const entry of entries) {
    const day = dayStart(entry.created_at)
    if (day !== currentDay) {
      currentDay = day
      sections.push({ title: dayTitle(day, today, yesterday), data: [] })
    }
    sections[sections.length - 1].data.push(entry)
  }
  return sections
}
