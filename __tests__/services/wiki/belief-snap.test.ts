import { backfillEntityEmbeddings } from '@/services/storage/entity-embeddings'
import { snapBeliefSemantic, snapBeliefsSemantic, backfillBeliefEmbeddings } from '@/services/wiki/belief-snap'
import { embedText } from '@/services/wiki/embeddings'

jest.mock('@/services/wiki/embeddings', () => ({
  embedText: jest.fn<Promise<{ success: true; data: number[] } | { success: false; error: { code: string; message: string } }>, [string]>(),
}))

jest.mock('@/services/storage/entity-embeddings', () => ({
  listEntityEmbeddings: jest.fn(),
  upsertEntityEmbedding: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  backfillEntityEmbeddings: jest.fn().mockResolvedValue(0),
}))

// mock cosine directly — lean on search.ts's own tests for the math
jest.mock('@/services/wiki/search', () => ({
  cosine: jest.fn((a: number[], b: number[]) => {
    if (a.length !== b.length) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
  }),
}))

const mockEmbedText = embedText as jest.MockedFunction<typeof embedText>
const mockListEntityEmbeddings = jest.mocked(require('@/services/storage/entity-embeddings').listEntityEmbeddings)

// Small 4-dim vectors that approximate similarity relationships
const SAD_VEC = [0.2, 0.8, -0.1, 0.3]
const WORTHLESS_VEC = [0.1, 0.7, -0.2, 0.2]  // ~0.95 with SAD — near-synonym
const LEAVE_VEC = [-0.3, 0.4, 0.6, 0.1]      // ~0.15 with SAD — unrelated

function vec(label: string): number[] {
  if (label.toLowerCase().includes('not good enough')) return WORTHLESS_VEC
  if (label.toLowerCase().includes('worthless')) return WORTHLESS_VEC
  if (label.toLowerCase().includes('inadequate')) return WORTHLESS_VEC
  if (label.toLowerCase().includes('leave')) return LEAVE_VEC
  if (label.toLowerCase().includes('abandon')) return LEAVE_VEC
  return SAD_VEC
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmbedText.mockImplementation((text: string) =>
    Promise.resolve({ success: true, data: vec(text) } as { success: true; data: number[] })
  )
})

describe('snapBeliefSemantic', () => {
  it('snaps a near-synonym to the existing label', async () => {
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: WORTHLESS_VEC, contentHash: '' }],
      ]),
    })

    const result = await snapBeliefSemantic('I feel worthless')
    expect(result).toBe('I am not good enough')
  })

  it('keeps a distinct belief when cosine is below threshold', async () => {
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: WORTHLESS_VEC, contentHash: '' }],
      ]),
    })

    const result = await snapBeliefSemantic('People will abandon me')
    // 'abandon' maps to LEAVE_VEC which is ~0.15 with WORTHLESS_VEC
    expect(result).toBe('People will abandon me')
  })

  it('returns the input unchanged when no stored embeddings exist yet', async () => {
    mockListEntityEmbeddings.mockResolvedValue({ success: true, data: new Map() })

    const result = await snapBeliefSemantic('I am not good enough')
    expect(result).toBe('I am not good enough')
  })

  it('returns the input unchanged when embed model fails', async () => {
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: WORTHLESS_VEC, contentHash: '' }],
      ]),
    })
    mockEmbedText.mockResolvedValue({ success: false, error: { code: 'EMBED_FAILED', message: 'Embedding failed' } })

    const result = await snapBeliefSemantic('I feel worthless')
    expect(result).toBe('I feel worthless')
  })

  it('returns the input unchanged when listEntityEmbeddings fails', async () => {
    mockListEntityEmbeddings.mockResolvedValue({ success: false, error: 'DB_ERR' })

    const result = await snapBeliefSemantic('I am not good enough')
    expect(result).toBe('I am not good enough')
  })
})

describe('snapBeliefsSemantic', () => {
  it('collapses multiple near-synonyms to one label', async () => {
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: WORTHLESS_VEC, contentHash: '' }],
      ]),
    })

    const result = await snapBeliefsSemantic(['I feel worthless', 'I am inadequate'])
    expect(result).toEqual(['I am not good enough'])
  })

  it('preserves distinct beliefs', async () => {
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map([
        ['I am not good enough', { label: 'I am not good enough', type: 'belief', vector: WORTHLESS_VEC, contentHash: '' }],
        ['People will leave', { label: 'People will leave', type: 'belief', vector: LEAVE_VEC, contentHash: '' }],
      ]),
    })

    const result = await snapBeliefsSemantic(['I feel worthless', 'People will abandon me'])
    expect(result).toEqual(['I am not good enough', 'People will leave'])
  })

  it('caps at 2', async () => {
    mockListEntityEmbeddings.mockResolvedValue({
      success: true,
      data: new Map(),
    })

    const result = await snapBeliefsSemantic(['A', 'B', 'C'])
    expect(result.length).toBeLessThanOrEqual(2)
  })

  it('returns empty input unchanged', async () => {
    const result = await snapBeliefsSemantic([])
    expect(result).toEqual([])
  })
})

describe('backfillBeliefEmbeddings', () => {
  it('delegates to backfillEntityEmbeddings with belief type', async () => {
    const result = await backfillBeliefEmbeddings()
    expect(result).toBe(0)
    expect(backfillEntityEmbeddings).toHaveBeenCalledWith('belief', embedText)
  })
})
