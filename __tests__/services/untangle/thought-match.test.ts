import { findExistingBeliefMatch } from '@/services/untangle/thought-match'
import { canonicalizeBelief } from '@/services/llm/taxonomy'

// We mock the storage/embedding boundary so the read-only matcher never touches
// the device DB or embedding model. Crucially, we also assert the side-effecting
// `upsertEntityEmbedding` is NEVER called — the matcher must not write.
jest.mock('@/services/storage/entity-embeddings', () => ({
  listEntityEmbeddings: jest.fn(),
  upsertEntityEmbedding: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))

jest.mock('@/services/storage/entities', () => ({
  listDistinctBeliefLabels: jest.fn(),
}))

jest.mock('@/services/wiki/embeddings', () => ({
  embedText: jest.fn(),
}))

const mockListEntityEmbeddings = jest.mocked(
  require('@/services/storage/entity-embeddings').listEntityEmbeddings
)
const mockUpsertEntityEmbedding = jest.mocked(
  require('@/services/storage/entity-embeddings').upsertEntityEmbedding
)
const mockListDistinctBeliefLabels = jest.mocked(
  require('@/services/storage/entities').listDistinctBeliefLabels
)
const mockEmbedText = jest.mocked(require('@/services/wiki/embeddings').embedText)

// A unit vector along axis i.
function unit(i: number, dim: number): number[] {
  const v = new Array(dim).fill(0)
  v[i] = 1
  return v
}

// A vector that is `cos` similar to `unit(i)` along axis i with the rest split.
function nearUnit(i: number, dim: number, cos: number): number[] {
  // x = cos*e_i + sin*(orthogonal), restore to unit norm if cos^2+sin^2 emancipates.
  const v = new Array(dim).fill(0)
  v[i] = cos
  const j = (i + 1) % dim
  v[j] = Math.sqrt(Math.max(0, 1 - cos * cos))
  return v
}

describe('findExistingBeliefMatch (read-only)', () => {
  beforeEach(() => {
    mockUpsertEntityEmbedding.mockClear()
    mockListEntityEmbeddings.mockReset()
    mockListDistinctBeliefLabels.mockReset()
    mockEmbedText.mockReset()
  })

  it('exact canonical-label match succeeds and reads no embeddings', async () => {
    const existing = 'I am not good enough'
    mockListDistinctBeliefLabels.mockResolvedValue({ success: true, data: [existing] })

    const res = await findExistingBeliefMatch("that I'm really not good enough")

    expect(res.belief).toBe('I am not good enough')
    expect(res.matchType).toBe('exact')
    // canonicalizeBelief brought the surface form to the same key — no need to embed.
    expect(mockEmbedText).not.toHaveBeenCalled()
  })

  it('semantic synonym at/above threshold succeeds; existing label returned', async () => {
    mockListDistinctBeliefLabels.mockResolvedValue({ success: true, data: [] })
    const beliefVector = unit(0, 12)
    const storedNear = nearUnit(0, 12, 0.85) // above 0.78
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: storedNear, contentHash: '' }],
      ]),
    })
    mockEmbedText.mockResolvedValue({ success: true, data: beliefVector })

    const res = await findExistingBeliefMatch('I am worthless')

    expect(res.belief).toBe('I am not good enough')
    expect(res.matchType).toBe('semantic')
  })

  it('opposite polarity does not match even when stripped text coincides', async () => {
    mockListDistinctBeliefLabels.mockResolvedValue({ success: true, data: [] })
    // "I am good enough" strips to "good enough"; the negated stored twin strips to the same.
    const beliefVector = unit(1, 12)
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: unit(1, 12), contentHash: '' }],
      ]),
    })
    // Match cosine high (the vectors are identical) — but polarity must block.
    mockEmbedText.mockResolvedValue({ success: true, data: beliefVector })

    const res = await findExistingBeliefMatch('I am good enough')

    expect(res.belief).toBeNull()
    expect(res.matchType).toBe('none')
  })

  it('unmatched thought returns null and does NOT upsert an entity embedding', async () => {
    mockListDistinctBeliefLabels.mockResolvedValue({ success: true, data: [] })
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am loved', { label: 'I am loved', type: 'belief', vector: unit(2, 12), contentHash: '' }],
      ]),
    })
    // orthogonal vector → cosine 0, well below threshold
    mockEmbedText.mockResolvedValue({ success: true, data: unit(5, 12) })

    const res = await findExistingBeliefMatch('I am a teapot')

    expect(res.belief).toBeNull()
    expect(res.matchType).toBe('none')
    expect(mockUpsertEntityEmbedding).not.toHaveBeenCalled()
  })

  it('embedding/DB failure degrades to null, never throws', async () => {
    mockListDistinctBeliefLabels.mockResolvedValue({ success: true, data: [] })
    mockListEntityEmbeddings.mockResolvedValue({ success: false, error: { code: 'X', message: 'db down' } })

    const res = await findExistingBeliefMatch('whatever')

    expect(res.belief).toBeNull()
    expect(res.matchType).toBe('none')
  })

  it('embedding model unavailable degrades to null without throwing', async () => {
    mockListDistinctBeliefLabels.mockResolvedValue({ success: true, data: [] })
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['X', { label: 'X', type: 'belief', vector: unit(0, 4), contentHash: '' }],
      ]),
    })
    mockEmbedText.mockResolvedValue({ success: false, error: { code: 'NO_MODEL', message: 'x' } })

    const res = await findExistingBeliefMatch('I am alone')

    expect(res.belief).toBeNull()
    expect(res.matchType).toBe('none')
    expect(mockUpsertEntityEmbedding).not.toHaveBeenCalled()
  })
})
