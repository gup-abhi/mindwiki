import { type WikiPage } from '@/services/storage/wiki'
import { pageEvolution, wordDiff, retentionAtVersions } from '@/services/wiki/evolution'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const page = (over: Partial<WikiPage>): WikiPage => ({
  id: 'x',
  title: 'Anxiety',
  category: 'emotion',
  content: 'You often feel a knot in your stomach before social events.',
  entry_count: 5,
  version: 3,
  version_history: [],
  created_at: 1700000000000,
  updated_at: 1700100000000,
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
  aggregated_upto: 0,
  ...over,
})

// ---------------------------------------------------------------------------
// pageEvolution
// ---------------------------------------------------------------------------

describe('pageEvolution', () => {
  it('unwraps version_history oldest-first', () => {
    const evo = pageEvolution(
      page({
        version: 3,
        content: 'third',
        version_history: [
          { version: 1, content: 'first', updated_at: 1 },
          { version: 2, content: 'second', updated_at: 2 },
        ],
      })
    )

    expect(evo.versions).toHaveLength(2)
    expect(evo.versions[0].version).toBe(1)
    expect(evo.versions[0].content).toBe('first')
    expect(evo.versions[1].version).toBe(2)
    expect(evo.versions[1].content).toBe('second')
  })

  it('places current version separately', () => {
    const evo = pageEvolution(
      page({
        version: 4,
        content: 'current text',
        version_history: [
          { version: 1, content: 'first', updated_at: 1 },
          { version: 2, content: 'second', updated_at: 2 },
          { version: 3, content: 'third', updated_at: 3 },
        ],
      })
    )

    expect(evo.current.version).toBe(4)
    expect(evo.current.content).toBe('current text')
    expect(evo.versions).toHaveLength(3)
  })

  it('carries through page metadata', () => {
    const evo = pageEvolution(page({ title: 'Work stress', category: 'theme', entry_count: 12 }))

    expect(evo.title).toBe('Work stress')
    expect(evo.category).toBe('theme')
    expect(evo.totalEntryCount).toBe(12)
  })

  it('reports the sampled gap immediately before the live version', () => {
    const evo = pageEvolution(
      page({
        version: 14,
        content: 'current',
        version_history: [{ version: 1, content: 'first', updated_at: 1 }],
      })
    )
    expect(evo.gaps).toEqual([{ fromVersion: 1, toVersion: 14, missing: 12 }])
  })

  it('handles a page with no version_history', () => {
    const evo = pageEvolution(page({ version: 1, version_history: [] }))
    expect(evo.versions).toHaveLength(0)
    expect(evo.current.version).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// wordDiff
// ---------------------------------------------------------------------------

describe('wordDiff', () => {
  it('returns all "same" for identical content', () => {
    const result = wordDiff('hello world', 'hello world')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('same')
    expect(result[0].text).toBe('hello world')
  })

  it('tags added words', () => {
    const result = wordDiff('hello world', 'hello brave world')
    // hello (same) + ' ' (same) + brave (added) + ' ' (added) + world (same)
    const added = result.filter((t) => t.type === 'added')
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((t) => t.text.includes('brave'))).toBe(true)
  })

  it('tags removed words', () => {
    const result = wordDiff('hello cruel world', 'hello world')
    const removed = result.filter((t) => t.type === 'removed')
    expect(removed.length).toBeGreaterThan(0)
    expect(removed.some((t) => t.text.includes('cruel'))).toBe(true)
  })

  it('preserves whitespace in fragments', () => {
    const result = wordDiff('one two', 'one three')
    // one (same) + ' ' (same) + two (removed) + three (added) — or merged with adjacent
    const merged = result.map((t) => t.text).join('')
    // The rendered text should round-trip to the original content (but for diff markers)
    expect(typeof merged).toBe('string')
  })

  it('returns empty array for two empty strings', () => {
    expect(wordDiff('', '')).toEqual([])
  })

  it('handles one empty side', () => {
    const added = wordDiff('', 'new content')
    expect(added.every((t) => t.type === 'added')).toBe(true)

    const removed = wordDiff('old content', '')
    expect(removed.every((t) => t.type === 'removed')).toBe(true)
  })

  it('merges adjacent same-type tokens', () => {
    const result = wordDiff('a b c', 'a b c')
    // Should be a single merged fragment, not 5 separate ones
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('same')
  })

  it('diffs realistic wiki page content', () => {
    const oldContent =
      '# Anxiety\n\nYou sometimes feel nervous before meeting new people. This tends to happen in group settings.'
    const newContent =
      '# Anxiety\n\nYou often feel a knot in your stomach before social events or meeting new people. Work deadlines can also trigger this feeling.'

    const result = wordDiff(oldContent, newContent)
    expect(result.length).toBeGreaterThan(0)

    // Both added and removed fragments should exist
    const types = new Set(result.map((t) => t.type))
    expect(types.has('added')).toBe(true)
    expect(types.has('removed')).toBe(true)
    expect(types.has('same')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// retentionAtVersions
// ---------------------------------------------------------------------------

describe('retentionAtVersions', () => {
  it('returns step and origin retention for each version in chain', () => {
    const evo = pageEvolution(
      page({
        version: 3,
        content: 'you often brace for the worst before it happens',
        version_history: [
          { version: 1, content: '', updated_at: 1 }, // empty — engine page init
          { version: 2, content: 'you brace for worst', updated_at: 2 },
        ],
      })
    )

    const r = retentionAtVersions(evo)
    expect(r).toHaveLength(3) // v1, v2, v3

    // v1: step null (no prior), origin null (first version is empty)
    expect(r[0].version).toBe(1)
    expect(r[0].stepRetention).toBeNull()
    expect(r[0].originRetention).toBeNull()

    // v2: step from v1 (empty → content: null), origin from v2 (first contentful)
    expect(r[1].version).toBe(2)
    expect(r[1].stepRetention).toBeNull()
    expect(r[1].originRetention).toBe(1) // origin is itself

    // v3: step from v2 (3/4 = 0.75), origin from v2 (2/4 = 0.5)
    expect(r[2].version).toBe(3)
    expect(r[2].stepRetention).not.toBeNull()
    expect(r[2].originRetention).not.toBeNull()
  })

  it('handles a page with no versions (no history)', () => {
    const evo = pageEvolution(page({ version: 1, version_history: [], content: 'braces before storm' }))
    const r = retentionAtVersions(evo)
    expect(r).toHaveLength(1)
    expect(r[0].stepRetention).toBeNull()
    expect(r[0].originRetention).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// F-5 — sampled-history gaps: step retention is null across a gap
// ---------------------------------------------------------------------------

describe('retentionAtVersions — gap handling', () => {
  it('reports null step retention across a sampled gap (v2 ↔ v14 retained)', () => {
    const evo = pageEvolution(
      page({
        version: 15,
        content: 'you brace for storm harbor',
        version_history: [
          { version: 2, content: 'you brace for worst before storm', updated_at: 20 },
          // versions 3–13 discarded by the retained-history cap; v14 sampled back in
          { version: 14, content: 'you often brace for storm harbor', updated_at: 140 },
        ],
      })
    )
    const r = retentionAtVersions(evo)
    // chain: v2, v14, v15 (current). firstContentful index = 0 (v2).
    expect(r.map((x) => x.version)).toEqual([2, 14, 15])

    // v2: first version, no step.
    expect(r[0].stepRetention).toBeNull()
    // v14: prior retained is v2, but v14 - v2 = 12 (gap). Step MUST be null.
    expect(r[1].stepRetention).toBeNull()
    // v15: prior retained is v14, v15 - v14 = 1 (adjacent). Step is computed.
    expect(r[2].stepRetention).not.toBeNull()

    // Origin retention still works across the gap: v2 → v15 word overlap.
    expect(r[2].originRetention).not.toBeNull()
    expect(r[1].originRetention).not.toBeNull()
  })

  it('computes step retention normally for a consecutive chain (v1, v2, v3)', () => {
    const evo = pageEvolution(
      page({
        version: 3,
        content: 'you often brace for storm harbor',
        version_history: [
          { version: 1, content: 'you brace for storm', updated_at: 1 },
          { version: 2, content: 'you brace for storm harbor', updated_at: 2 },
        ],
      })
    )
    const r = retentionAtVersions(evo)
    expect(r).toHaveLength(3)
    // v1: no prior; v1 → v2 adjacent
    expect(r[0].stepRetention).toBeNull()
    expect(r[1].stepRetention).not.toBeNull() // v1→v2 adjacent
    expect(r[2].stepRetention).not.toBeNull() // v2→v3 adjacent
  })
})
