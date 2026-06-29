import { saveDraft, loadDraft, clearDraft } from '@/services/storage/draft'
import { getSetting, setSetting } from '@/services/storage/settings'
import { ok } from '@/types/result'
import { type EntryDraft } from '@/store/entry.store'

jest.mock('@/services/storage/settings', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }))

const mockGet = getSetting as jest.Mock
const mockSet = setSetting as jest.Mock

const draft: EntryDraft = { mood: 3, energy: 4, body: 'hi', thought: '', emotion: 'Anxious' }

describe('storage/draft', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockSet.mockReset().mockResolvedValue(ok(undefined))
  })

  it('persists the draft as JSON under one key', async () => {
    await saveDraft(draft)
    expect(mockSet).toHaveBeenCalledWith('entry_draft', JSON.stringify(draft))
  })

  it('loads and parses a saved draft', async () => {
    mockGet.mockResolvedValue(ok(JSON.stringify(draft)))
    expect(await loadDraft()).toEqual(draft)
  })

  it('returns null when there is no draft', async () => {
    mockGet.mockResolvedValue(ok(null))
    expect(await loadDraft()).toBeNull()
  })

  it('returns null on an empty or unparseable value instead of throwing', async () => {
    mockGet.mockResolvedValue(ok('')) // cleared draft
    expect(await loadDraft()).toBeNull()
    mockGet.mockResolvedValue(ok('{not json'))
    expect(await loadDraft()).toBeNull()
  })

  it('clears by writing an empty value', async () => {
    await clearDraft()
    expect(mockSet).toHaveBeenCalledWith('entry_draft', '')
  })
})
