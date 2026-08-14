import { type Entry } from '@/services/storage/entries'

export function entryPreview(entry: Pick<Entry, 'situation' | 'thought'>): string {
  return entry.situation.trim() || entry.thought.trim() || 'Mood check-in.'
}
