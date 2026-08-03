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
  /** Deterministic projection of the synced columns — the equal-ts tie-break. */
  content?: string | null
}

export interface LocalVersion {
  updated_at: number
  /** Content projection of the local row (null when unknown). */
  content: string | null
}

/**
 * Apply a remote record when there's no local copy, the remote is newer, or —
 * on an exact timestamp tie — the remote content projection is larger.
 *
 * Equal updated_at means two devices edited the same record in the same
 * millisecond; timestamps alone can't pick a winner and sync_id is a
 * deterministic HMAC of the record id (identical on every device), so content
 * is the only per-version discriminator. The max-content rule is the same on
 * every device, so both sides converge on one version. Own pushes project to
 * identical content — they are skipped, so re-pulling never churns.
 */
export function shouldApplyRemote(
  localUpdatedAt: number | null,
  localContent: string | null,
  remoteUpdatedAt: number,
  remoteContent: string | null
): boolean {
  if (localUpdatedAt === null) return true
  if (remoteUpdatedAt > localUpdatedAt) return true
  if (remoteUpdatedAt < localUpdatedAt) return false
  if (localContent === null || remoteContent === null) return false // unknown — keep local
  return remoteContent > localContent
}

/**
 * Filter a batch of remote records down to those that should be written
 * locally, given a lookup of the local version for each record id.
 */
export function recordsToApply<R extends Versioned>(
  remote: R[],
  localVersion: (recordId: string) => LocalVersion | null
): R[] {
  return remote.filter((r) => {
    const local = localVersion(r.record_id)
    return shouldApplyRemote(
      local?.updated_at ?? null,
      local?.content ?? null,
      r.updated_at,
      r.content ?? null
    )
  })
}
