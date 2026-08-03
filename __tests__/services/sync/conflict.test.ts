import { shouldApplyRemote, recordsToApply, SYNCED_TABLES } from '@/services/sync/conflict'

describe('shouldApplyRemote (last-write-wins)', () => {
  it('applies when there is no local copy', () => {
    expect(shouldApplyRemote(null, null, 100, null)).toBe(true)
  })
  it('applies when the remote is newer', () => {
    expect(shouldApplyRemote(100, 'local', 200, 'remote')).toBe(true)
  })
  it('skips when the remote is older', () => {
    expect(shouldApplyRemote(200, 'local', 100, 'remote')).toBe(false)
  })
  it('keeps local when contents are equal on an exact timestamp tie (own push)', () => {
    expect(shouldApplyRemote(100, 'same', 100, 'same')).toBe(false)
  })
  it('breaks equal timestamps toward the larger content', () => {
    // remote wins the tie
    expect(shouldApplyRemote(100, 'aaa', 100, 'bbb')).toBe(true)
    // local wins the tie — same rule on every device, so both converge
    expect(shouldApplyRemote(100, 'bbb', 100, 'aaa')).toBe(false)
  })
  it('keeps local when either content is unknown', () => {
    expect(shouldApplyRemote(100, null, 100, 'aaa')).toBe(false)
    expect(shouldApplyRemote(100, 'aaa', 100, null)).toBe(false)
  })
})

describe('recordsToApply', () => {
  it('keeps only new or newer remote records', () => {
    const local: Record<string, { updated_at: number; content: string | null }> = {
      a: { updated_at: 50, content: 'ca' },
      b: { updated_at: 300, content: 'cb' },
    }
    const remote = [
      { record_id: 'a', updated_at: 100, content: 's1' }, // newer -> apply
      { record_id: 'b', updated_at: 200, content: 's2' }, // older -> skip
      { record_id: 'c', updated_at: 10, content: 's3' }, // new -> apply
    ]
    const out = recordsToApply(remote, (id) => local[id] ?? null)
    expect(out.map((r) => r.record_id)).toEqual(['a', 'c'])
  })

  it('resolves equal timestamps via content (larger wins)', () => {
    const local: Record<string, { updated_at: number; content: string | null }> = {
      a: { updated_at: 100, content: 'aaa' },
    }
    const out = recordsToApply(
      [
        { record_id: 'a', updated_at: 100, content: 'ccc' }, // remote wins tie
        { record_id: 'b', updated_at: 100, content: 'x' }, // no local -> apply
      ],
      (id) => local[id] ?? null
    )
    expect(out.map((r) => r.record_id)).toEqual(['a', 'b'])
  })
})

describe('SYNCED_TABLES', () => {
  it('covers the blob-synced tables (excludes the locally-rebuilt graph_nodes/edges)', () => {
    expect(SYNCED_TABLES).toEqual([
      'entries',
      'wiki_pages',
      'entry_entities',
      'conversations',
      'chat_messages',
      'challenges',
      // user intent, not derivable from entries — must travel between devices
      'graph_node_dismissals',
      // user-authored belief reframes — must travel between devices
      'belief_reframes',
      // user-chosen streak freezes — the streak derives from entries ∪ these days
      'streak_freezes',
    ])
  })

  it('orders conversations before chat_messages so the FK parent applies first', () => {
    expect(SYNCED_TABLES.indexOf('conversations')).toBeLessThan(
      SYNCED_TABLES.indexOf('chat_messages')
    )
  })
})
