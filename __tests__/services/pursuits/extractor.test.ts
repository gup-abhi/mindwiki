import {
  extractPursuit,
  matchActivePursuit,
  normalizePursuitTitle,
} from '@/services/pursuits/extractor'
import { createPursuit, listPursuits, updatePursuit, type Pursuit } from '@/services/storage/pursuits'
import { synthesizePursuitDetails } from '@/services/llm/deep-model'
import { ok, err } from '@/types/result'

jest.mock('@/services/storage/pursuits', () => ({
  createPursuit: jest.fn(),
  listPursuits: jest.fn(),
  updatePursuit: jest.fn(),
}))
jest.mock('@/services/llm/deep-model', () => ({ synthesizePursuitDetails: jest.fn() }))

const mockCreate = createPursuit as jest.Mock
const mockList = listPursuits as jest.Mock
const mockUpdate = updatePursuit as jest.Mock
const mockSynth = synthesizePursuitDetails as jest.Mock

const pursuit = (over: Partial<Pursuit>): Pursuit => ({
  id: 'p1',
  title: 'Marathon training',
  details: 'Building toward a fall race.',
  status: 'active',
  checkin_question: '',
  wiki_page_id: null,
  created_at: 0,
  updated_at: 0,
  last_mentioned_at: 0,
  last_checkin_at: null,
  ...over,
})

describe('normalizePursuitTitle', () => {
  it('trims, strips trailing punctuation, and capitalizes', () => {
    expect(normalizePursuitTitle('  marathon training!  ')).toBe('Marathon training')
  })

  it('rejects too-short and filler phrases', () => {
    expect(normalizePursuitTitle('  ')).toBeNull()
    expect(normalizePursuitTitle('hi')).toBeNull()
    expect(normalizePursuitTitle('none')).toBeNull()
    expect(normalizePursuitTitle('Nothing specific')).toBeNull()
    expect(normalizePursuitTitle('myself')).toBeNull()
  })
})

describe('matchActivePursuit', () => {
  it('matches case-insensitively on equality or containment', () => {
    const pursuits = [pursuit({ id: 'p1', title: 'Marathon training' })]
    expect(matchActivePursuit('marathon training', pursuits)?.id).toBe('p1')
    expect(matchActivePursuit('Marathon', pursuits)?.id).toBe('p1') // containment
  })

  it('ignores non-active pursuits', () => {
    const pursuits = [pursuit({ id: 'p1', title: 'Marathon training', status: 'done' })]
    expect(matchActivePursuit('Marathon training', pursuits)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchActivePursuit('Learning guitar', [pursuit({ title: 'Marathon training' })])).toBeNull()
  })
})

describe('extractPursuit', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockList.mockReset()
    mockUpdate.mockReset()
    mockSynth.mockReset()
    mockUpdate.mockResolvedValue(ok(pursuit({})))
    mockSynth.mockResolvedValue(ok('A fresh note.'))
  })

  it('does nothing for a filler phrase', async () => {
    await extractPursuit('none', 'text')
    expect(mockList).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a new pursuit and writes its synthesized note', async () => {
    mockList.mockResolvedValue(ok([]))
    mockCreate.mockResolvedValue(ok(pursuit({ id: 'new1', title: 'Learning guitar' })))

    await extractPursuit('learning guitar', 'practiced chords today')

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Learning guitar' })
    expect(mockSynth).toHaveBeenCalledWith({
      title: 'Learning guitar',
      existingDetails: '',
      entryText: 'practiced chords today',
    })
    expect(mockUpdate).toHaveBeenCalledWith('new1', { details: 'A fresh note.' })
  })

  it('updates an existing active pursuit (bumps mention + refreshes note)', async () => {
    mockList.mockResolvedValue(ok([pursuit({ id: 'p1', title: 'Marathon training' })]))

    await extractPursuit('marathon training', 'ran 10k')

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [id, patch] = mockUpdate.mock.calls[0]
    expect(id).toBe('p1')
    expect(patch.details).toBe('A fresh note.')
    expect(typeof patch.last_mentioned_at).toBe('number')
  })

  it('still bumps the mention when synthesis fails (no details in the patch)', async () => {
    mockList.mockResolvedValue(ok([pursuit({ id: 'p1', title: 'Marathon training' })]))
    mockSynth.mockResolvedValue(err('PURSUIT_SYNTH_INFERENCE_FAILED', 'x'))

    await extractPursuit('marathon training', 'ran 10k')

    const [, patch] = mockUpdate.mock.calls[0]
    expect(patch.details).toBeUndefined()
    expect(typeof patch.last_mentioned_at).toBe('number')
  })
})
