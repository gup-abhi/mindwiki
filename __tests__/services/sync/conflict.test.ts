import { shouldApplyRemote, recordsToApply, SYNCED_TABLES } from '@/services/sync/conflict'

describe('shouldApplyRemote (last-write-wins)', () => {
  it('applies when there is no local copy', () => {
    expect(shouldApplyRemote(null, 100)).toBe(true)
  })
  it('applies when the remote is newer', () => {
    expect(shouldApplyRemote(100, 200)).toBe(true)
  })
  it('skips when the remote is older or equal', () => {
    expect(shouldApplyRemote(200, 100)).toBe(false)
    expect(shouldApplyRemote(200, 200)).toBe(false)
  })
})

describe('recordsToApply', () => {
  it('keeps only new or newer remote records', () => {
    const local: Record<string, number> = { a: 50, b: 300 }
    const remote = [
      { record_id: 'a', updated_at: 100 }, // newer -> apply
      { record_id: 'b', updated_at: 200 }, // older -> skip
      { record_id: 'c', updated_at: 10 }, // new -> apply
    ]
    const out = recordsToApply(remote, (id) => local[id] ?? null)
    expect(out.map((r) => r.record_id)).toEqual(['a', 'c'])
  })
})

describe('SYNCED_TABLES', () => {
  it('covers entries and wiki_pages, excludes graph tables', () => {
    expect(SYNCED_TABLES).toEqual(['entries', 'wiki_pages'])
  })
})
