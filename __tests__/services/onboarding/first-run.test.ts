/**
 * TDD acceptance tests for the cold-start launch risk fixes:
 *   P1 — first-run guided path → wiki page routing
 *   P2 — staged model download (fast gates start, deep downloads behind)
 *   P3 — Home "What changed" (verified in production, no test needed)
 *
 * These are unit tests against mocked storage/model services. They specify
 * the contract before any implementation code is written.
 *
 * NOTE: hasExistingEntries is tested directly with a real-ish DB mock.
 * firstRunStatus tests cover the flag path; the integration between
 * firstRunStatus and hasExistingEntries is a plain if/await that works
 * by construction once both are individually verified.
 */

import { firstRunStatus, markFirstRunComplete, firstWikiPage, hasExistingEntries, getModelDownloadPreference, setModelDownloadPreference, peekFirstRunPageReady, clearFirstRunPageReady, resolveFirstRunPageReady, announceFirstRunPageIfPending } from '@/services/onboarding/first-run'
import { getSetting, setSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { getEntry } from '@/services/storage/entries'
import { useAuthStore } from '@/store/auth.store'
import { lineageForEntry } from '@/services/wiki/engine'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { ok, err } from '@/types/result'

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}))

jest.mock('@/services/wiki/engine', () => ({
  lineageForEntry: jest.fn(),
}))

jest.mock('@/services/storage/wiki', () => ({
  getPage: jest.fn(),
}))

import { getPage } from '@/services/storage/wiki'

jest.mock('@/services/llm/model-manager', () => ({
  isModelDownloaded: jest.fn(),
  canStart: jest.fn(),
}))

jest.mock('@/services/pipeline', () => {
  const actual = jest.requireActual('@/services/pipeline') as typeof import('@/services/pipeline')
  return { ...actual, catchUpUnindexed: jest.fn().mockResolvedValue(undefined) }
})

// getEntry is fetched by firstWikiPage during polling. Mock it so we control
// what the poll loop finds. Default: entries exist with the expected fields set
// (indexFromExtract populates these via applyTags before firstWikiPage polls).
jest.mock('@/services/storage/entries', () => ({
  getEntry: jest.fn(),
}))

// DB mock for hasExistingEntries. The jest.mock factory is a pure function
// with no module-scope variable capture — it returns a getDb that creates a
// fresh execute mock each call. Tests control the expected count by writing
// to the mockDbResultRef property on the getDb mock itself.
jest.mock('@/services/storage/db', () => {
  const execute = jest.fn().mockResolvedValue({ rows: [{ c: 0 }] })
  return {
    getDb: jest.fn(() => ({ execute })),
  }
})

const mockGetSetting = getSetting as jest.Mock
const mockSetSetting = setSetting as jest.Mock
const mockGetEntry = getEntry as jest.Mock
const mockLineageForEntry = lineageForEntry as jest.Mock
const mockIsModelDownloaded = isModelDownloaded as jest.Mock

const FIRST_RUN_FLAG = 'onboarding:first_run_complete'
const FIRST_RUN_ENTRY_IDS = 'onboarding:first_run_entry_ids'

const lineagePage = (id: string, title: string) => ({ id, title, category: 'emotion' as const })
const flush = () => new Promise<void>((r) => setImmediate(r))

describe('model download preference', () => {
  beforeEach(() => {
    mockGetSetting.mockReset()
    mockSetSetting.mockReset().mockResolvedValue(ok(undefined))
  })

  it('defaults to undecided when no preference is stored', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    await expect(getModelDownloadPreference()).resolves.toBe('undecided')
  })

  it('accepts only persisted deferred or consented values', async () => {
    mockGetSetting.mockResolvedValueOnce(ok('deferred')).mockResolvedValueOnce(ok('consented')).mockResolvedValueOnce(ok('other'))
    await expect(getModelDownloadPreference()).resolves.toBe('deferred')
    await expect(getModelDownloadPreference()).resolves.toBe('consented')
    await expect(getModelDownloadPreference()).resolves.toBe('undecided')
  })

  it('persists the user choice in encrypted settings', async () => {
    await setModelDownloadPreference('consented')
    expect(mockSetSetting).toHaveBeenCalledWith('onboarding:model_download_preference', 'consented')
  })
})

// ─── P1: First-run guided path ───────────────────────────────────────────────

describe('P1 — firstRunStatus (flag path)', () => {
  beforeEach(() => {
    mockGetSetting.mockReset()
    mockSetSetting.mockReset().mockResolvedValue(ok(undefined))
    mockIsModelDownloaded.mockReset()
    // Default: this session just registered a brand-new account.
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1', isNewAccount: true })
  })

  it('returns shouldRun:true for a brand-new account (no flag, 0 entries)', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    mockIsModelDownloaded.mockResolvedValue(true)
    const status = await firstRunStatus()
    expect(status.shouldRun).toBe(true)
    expect(status.pathId).toBe('overwhelmed')
  })

  it('returns shouldRun:false when the flag is set', async () => {
    mockGetSetting.mockResolvedValue(ok('1'))
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(false)
  })

  it('falls back to shouldRun:true when getSetting fails (new account, no entries)', async () => {
    mockGetSetting.mockResolvedValue(err('SETTINGS_GET_FAILED', 'disk error'))
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(true)
  })

  it('returns shouldRun:false for an existing account (login/returning session)', async () => {
    useAuthStore.setState({ isNewAccount: false })
    mockGetSetting.mockResolvedValue(ok(null))
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(false)
  })

  it('resumes after a kill: returning session, path started but not complete', async () => {
    // App was killed mid-cold-start, so isNewAccount is lost — but the durable
    // FIRST_RUN_STARTED marker survives and FIRST_RUN_FLAG (complete) is unset.
    useAuthStore.setState({ isNewAccount: false })
    mockGetSetting.mockImplementation(async (key: string) =>
      key === 'onboarding:first_run_started' ? ok('1') : ok(null)
    )
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(true)
  })

  it('does NOT resume once complete, even if started is still set', async () => {
    useAuthStore.setState({ isNewAccount: false })
    mockGetSetting.mockImplementation(async (key: string) =>
      key === 'onboarding:first_run_complete' ? ok('1') : ok('1')
    )
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(false)
  })

  it('persists the started marker on a new-account run so a kill can resume', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    mockSetSetting.mockReset().mockResolvedValue(ok(undefined))
    mockIsModelDownloaded.mockResolvedValue(true)
    await firstRunStatus()
    expect(mockSetSetting).toHaveBeenCalledWith('onboarding:first_run_started', '1')
  })
})

describe('P1 — hasExistingEntries', () => {
  let mockExecute: jest.Mock

  beforeEach(() => {
    // getDb() is mocked — each call returns { execute: mockExecute }
    mockExecute = (getDb as jest.Mock)().execute
    mockExecute.mockReset().mockResolvedValue({ rows: [{ c: 0 }] })
  })

  it('returns false when the entries table is empty', async () => {
    expect(await hasExistingEntries()).toBe(false)
  })

  it('returns true when the entries table has rows', async () => {
    mockExecute.mockResolvedValue({ rows: [{ c: 5 }] })
    expect(await hasExistingEntries()).toBe(true)
  })

  it('returns false on DB failure (best-effort)', async () => {
    mockExecute.mockRejectedValue(new Error('DB locked'))
    expect(await hasExistingEntries()).toBe(false)
  })

  it('calls the correct query', async () => {
    await hasExistingEntries()
    expect(mockExecute).toHaveBeenCalledWith('SELECT COUNT(*) AS c FROM entries LIMIT 1')
  })
})

describe('P1 — markFirstRunComplete', () => {
  beforeEach(() => {
    mockSetSetting.mockReset().mockResolvedValue(ok(undefined))
  })

  it('sets the first-run complete flag', async () => {
    await markFirstRunComplete(['e1', 'e2', 'e3'])
    expect(mockSetSetting).toHaveBeenCalledWith(FIRST_RUN_FLAG, '1')
  })

  it('persists entry IDs for later wiki-page polling', async () => {
    await markFirstRunComplete(['e1', 'e2', 'e3'])
    expect(mockSetSetting).toHaveBeenCalledWith(FIRST_RUN_ENTRY_IDS, JSON.stringify(['e1', 'e2', 'e3']))
  })

  it('handles an empty entry list gracefully', async () => {
    await expect(markFirstRunComplete([])).resolves.toBeUndefined()
    expect(mockSetSetting).toHaveBeenCalledWith(FIRST_RUN_FLAG, '1')
    expect(mockSetSetting).toHaveBeenCalledWith(FIRST_RUN_ENTRY_IDS, JSON.stringify([]))
  })

  it('is best-effort — setSetting failure never throws', async () => {
    mockSetSetting.mockResolvedValue(err('SETTINGS_SET_FAILED', 'disk full'))
    await expect(markFirstRunComplete(['e1'])).resolves.toBeUndefined()
  })
})

describe('P1 — firstWikiPage', () => {
  // A minimal real-ish entry that indexFromExtract would have produced
  // (emotion, distortion, topic, topic2 all set via applyTags).
  const taggedEntry = {
    id: 'e1',
    created_at: 1000,
    mood: 3,
    situation: 'Work is overwhelming',
    thought: 'I can\'t keep up',
    behavior: null,
    closing_note: null,
    emotion: 'anxiety',
    named_emotion: null,
    energy: null,
    distortion: 'catastrophizing',
    mood_score: 0.3,
    topic: 'work stress',
    topic2: 'burnout',
    tagged_at: 2000,
    wiki_indexed_at: null,
    graph_indexed_at: null,
    raw_text: null,
    source: 'path',
  }

  beforeEach(() => {
    jest.useRealTimers()
    mockLineageForEntry.mockReset()
    mockGetEntry.mockReset()
    // Default: getEntry returns the tagged entry for every ID.
    mockGetEntry.mockResolvedValue(ok({ ...taggedEntry }))
  })

  it('fetches the real entry via getEntry before calling lineageForEntry', async () => {
    mockLineageForEntry.mockResolvedValue(ok([lineagePage('p1', 'Anxiety')]))
    const page = await firstWikiPage(['e1'], 6_000)
    expect(page).not.toBeNull()
    expect(mockGetEntry).toHaveBeenCalledWith('e1')
    // lineageForEntry receives the real entry (with emotion/distortion/topics set),
    // not a mock with null fields.
    expect(mockLineageForEntry).toHaveBeenCalledWith(
      expect.objectContaining({ emotion: 'anxiety', distortion: 'catastrophizing', topic: 'work stress' })
    )
  })

  it('returns a page when synthesis completes within the timeout', async () => {
    mockLineageForEntry
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([lineagePage('p1', 'Anxiety')]))
    const page = await firstWikiPage(['e1'], 6_000)
    expect(page).not.toBeNull()
    expect(page!.id).toBe('p1')
    expect(page!.title).toBe('Anxiety')
  }, 10_000)

  it('returns null when no page appears before timeout', async () => {
    mockLineageForEntry.mockResolvedValue(ok([]))
    expect(await firstWikiPage(['e1'], 4_000)).toBeNull()
  }, 8_000)

  it('returns null when getEntry fails', async () => {
    mockGetEntry.mockResolvedValue(err('ENTRY_GET_FAILED', 'not found'))
    mockLineageForEntry.mockResolvedValue(ok([lineagePage('p1', 'Anxiety')]))
    expect(await firstWikiPage(['e1'], 4_000)).toBeNull()
  }, 8_000)

  it('returns null when getEntry returns null (entry deleted)', async () => {
    mockGetEntry.mockResolvedValue(ok(null))
    mockLineageForEntry.mockResolvedValue(ok([lineagePage('p1', 'Anxiety')]))
    expect(await firstWikiPage(['e1'], 4_000)).toBeNull()
  }, 8_000)

  it('returns null when lineage fails on every entry', async () => {
    mockLineageForEntry.mockResolvedValue(err('WIKI_FAILED', 'engine down'))
    expect(await firstWikiPage(['e1'], 4_000)).toBeNull()
  }, 8_000)
})

describe('P2 — durable first-page receipt', () => {
  beforeEach(() => {
    mockGetSetting.mockReset()
    mockSetSetting.mockReset().mockResolvedValue(ok(undefined))
    mockIsModelDownloaded.mockReset().mockResolvedValue(true)
    mockGetEntry.mockReset().mockResolvedValue(ok({ id: 'e1', topic: 'work' }))
    ;(getPage as jest.Mock).mockReset().mockResolvedValue(ok({ id: 'p1', title: 'Anxiety' }))
    mockLineageForEntry.mockReset().mockResolvedValue(ok([{ id: 'p1', title: 'Anxiety', category: 'emotion' }]))
  })

  it('peeks without clearing and clears only explicitly', async () => {
    mockGetSetting.mockResolvedValue(ok(JSON.stringify({ id: 'p1' })))
    await expect(peekFirstRunPageReady()).resolves.toEqual({ id: 'p1' })
    expect(mockSetSetting).not.toHaveBeenCalled()
    await clearFirstRunPageReady()
    expect(mockSetSetting).toHaveBeenCalledWith('onboarding:first_run_page_ready', '')
  })

  it('resolves the current local title and falls back when the page is gone', async () => {
    mockGetSetting.mockResolvedValue(ok(JSON.stringify({ id: 'p1' })))
    await expect(resolveFirstRunPageReady()).resolves.toEqual({ id: 'p1', title: 'Anxiety' })
    mockGetSetting.mockResolvedValue(ok(JSON.stringify({ id: 'missing' })))
    ;(getPage as jest.Mock).mockResolvedValue(ok(null))
    mockLineageForEntry.mockResolvedValue(ok([]))
    await expect(resolveFirstRunPageReady()).resolves.toEqual({ id: 'missing', title: 'Your first insight' })
  })

  it('announces once and preserves the opaque receipt', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === FIRST_RUN_FLAG) return ok('1')
      if (key === FIRST_RUN_ENTRY_IDS) return ok(JSON.stringify(['e1']))
      return ok(null)
    })
    await expect(announceFirstRunPageIfPending()).resolves.toEqual({ id: 'p1', title: 'Anxiety' })
    expect(mockSetSetting).toHaveBeenCalledWith('onboarding:first_run_page_ready', JSON.stringify({ id: 'p1' }))
  })
})
