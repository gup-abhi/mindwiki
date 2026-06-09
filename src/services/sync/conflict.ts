// Per-table conflict resolution for delta sync.
//
// entries + wiki_pages + entry_entities sync as encrypted blobs with
// last-write-wins by updated_at. Graph tables are additive (ADR 006) and are
// rebuilt locally from entries + entry_entities rather than blob-synced, so they
// are intentionally not in this set.

export type SyncTable = 'entries' | 'wiki_pages' | 'entry_entities'

export const SYNCED_TABLES: SyncTable[] = ['entries', 'wiki_pages', 'entry_entities']

export interface Versioned {
  record_id: string
  updated_at: number
}

/** Apply a remote record when there's no local copy or the remote is newer. */
export function shouldApplyRemote(localUpdatedAt: number | null, remoteUpdatedAt: number): boolean {
  return localUpdatedAt === null || remoteUpdatedAt > localUpdatedAt
}

/**
 * Filter a batch of remote records down to those that should be written
 * locally, given a lookup of the local updated_at for each record id.
 */
export function recordsToApply<R extends Versioned>(
  remote: R[],
  localUpdatedAt: (recordId: string) => number | null
): R[] {
  return remote.filter((r) => shouldApplyRemote(localUpdatedAt(r.record_id), r.updated_at))
}
