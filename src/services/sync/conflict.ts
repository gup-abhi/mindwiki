// Per-table conflict resolution for delta sync.
//
// entries + wiki_pages + entry_entities + conversations + chat_messages sync as
// encrypted blobs with last-write-wins by updated_at. The graph_nodes/graph_edges
// tables are additive (ADR 006) and rebuilt locally from entries, so they are
// intentionally not synced. graph_node_dismissals IS synced, though — it's user
// intent (which nodes to drop), not derivable from entries, so it must travel.
//
// conversations is listed before chat_messages so a pull applies the parent rows
// first (chat_messages references conversations).

export type SyncTable =
  | 'entries'
  | 'wiki_pages'
  | 'entry_entities'
  | 'conversations'
  | 'chat_messages'
  | 'challenges'
  | 'graph_node_dismissals'
  | 'belief_reframes'
  | 'streak_freezes'

export const SYNCED_TABLES: readonly SyncTable[] = [
  'entries',
  'wiki_pages',
  'entry_entities',
  'conversations',
  'chat_messages',
  'challenges',
  'graph_node_dismissals',
  'belief_reframes',
  'streak_freezes',
]

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
