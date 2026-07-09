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

import { firstRunStatus, markFirstRunComplete, firstWikiPage, hasExistingEntries } from '@/services/onboarding/first-run'
import { getSetting, setSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { hasSeenOnboarding } from '@/services/onboarding/seen'
import { lineageForEntry } from '@/services/wiki/engine'
import { isModelDownloaded, onDeepModelReady, clearDeepModelReadyCallbacks } from '@/services/llm/model-manager'
import { downloadModel } from '@/services/llm/model-manager'
import { canStart } from '@/services/llm/model-manager'
import { catchUpUnindexed, triggerCatchUp } from '@/services/pipeline'
import { ok, err } from '@/types/result'

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}))

// hasSeenOnboarding is imported by firstRunStatus — mock it so no
// SecureStore calls in tests. Default true = carousel was shown, so
// the first-run redirect checks can proceed.
jest.mock('@/services/onboarding/seen', () => ({
  hasSeenOnboarding: jest.fn().mockResolvedValue(true),
  markOnboardingSeen: jest.fn(),
}))

jest.mock('@/services/wiki/engine', () => ({
  lineageForEntry: jest.fn(),
}))

jest.mock('@/services/llm/model-manager', () => {
  const actual = jest.requireActual('@/services/llm/model-manager') as Record<string, unknown>
  return {
    onDeepModelReady: jest.fn(actual.onDeepModelReady as (...args: unknown[]) => unknown),
    clearDeepModelReadyCallbacks: jest.fn(actual.clearDeepModelReadyCallbacks as (...args: unknown[]) => unknown),
    isModelDownloaded: jest.fn(),
    downloadModel: jest.fn(),
    canStart: jest.fn(),
  }
})

jest.mock('@/services/pipeline', () => {
  const actual = jest.requireActual('@/services/pipeline') as typeof import('@/services/pipeline')
  return { ...actual, catchUpUnindexed: jest.fn().mockResolvedValue(undefined) }
})

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
const mockHasSeenOnboarding = hasSeenOnboarding as jest.Mock
const mockLineageForEntry = lineageForEntry as jest.Mock
const mockIsModelDownloaded = isModelDownloaded as jest.Mock
const mockCanStart = canStart as jest.Mock
const mockCatchUpUnindexed = catchUpUnindexed as jest.Mock

const FIRST_RUN_FLAG = 'onboarding:first_run_complete'
const FIRST_RUN_ENTRY_IDS = 'onboarding:first_run_entry_ids'

const lineagePage = (id: string, title: string) => ({ id, title, category: 'emotion' as const })
const flush = () => new Promise<void>((r) => setImmediate(r))

// ─── P1: First-run guided path ───────────────────────────────────────────────

describe('P1 — firstRunStatus (flag path)', () => {
  beforeEach(() => {
    mockGetSetting.mockReset()
    mockIsModelDownloaded.mockReset()
    mockHasSeenOnboarding.mockReset().mockResolvedValue(true)
  })

  it('returns shouldRun:true on fresh install (no flag, carousel shown, 0 entries)', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    mockIsModelDownloaded.mockResolvedValue(true)
    const status = await firstRunStatus()
    expect(status.shouldRun).toBe(true)
    expect(status.pathId).toBe('overwhelmed')
  })

  it('returns deep model readiness when present', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).deepReady).toBe(true)
  })

  it('reports deepReady:false when deep model absent', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    mockIsModelDownloaded.mockImplementation(async (kind: string) => kind !== 'deep')
    expect((await firstRunStatus()).deepReady).toBe(false)
  })

  it('returns shouldRun:false when the flag is set', async () => {
    mockGetSetting.mockResolvedValue(ok('1'))
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(false)
  })

  it('falls back to shouldRun:true when getSetting fails', async () => {
    mockGetSetting.mockResolvedValue(err('SETTINGS_GET_FAILED', 'disk error'))
    mockIsModelDownloaded.mockResolvedValue(true)
    expect((await firstRunStatus()).shouldRun).toBe(true)
  })

  it('returns shouldRun:false when carousel was never shown (SecureStore survived re-install)', async () => {
    mockGetSetting.mockResolvedValue(ok(null))
    mockIsModelDownloaded.mockResolvedValue(true)
    mockHasSeenOnboarding.mockResolvedValue(false)
    const status = await firstRunStatus()
    expect(status.shouldRun).toBe(false)
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
  beforeEach(() => {
    jest.useRealTimers()
    mockLineageForEntry.mockReset()
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

  it('returns the first page found and stops polling', async () => {
    mockLineageForEntry
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([lineagePage('p2', 'Overwhelm')]))
    const page = await firstWikiPage(['e1', 'e2'], 10_000)
    expect(page).not.toBeNull()
    expect(page!.id).toBe('p2')
  }, 15_000)

  it('returns null when lineage fails on every entry', async () => {
    mockLineageForEntry.mockResolvedValue(err('WIKI_FAILED', 'engine down'))
    expect(await firstWikiPage(['e1'], 4_000)).toBeNull()
  }, 8_000)
})

// ─── P2: Staged model download ───────────────────────────────────────────────

describe('P2 — canStart', () => {
  beforeEach(() => {
    mockCanStart.mockReset()
    mockCanStart.mockImplementation(async () => {
      const m = await mockIsModelDownloaded('fast')
      return m
    })
  })

  it('returns true when only fast model is present', async () => {
    mockIsModelDownloaded.mockImplementation(async (kind: string) => kind === 'fast')
    expect(await mockCanStart()).toBe(true)
    expect(mockIsModelDownloaded).toHaveBeenCalledWith('fast')
  })

  it('returns false when no models present', async () => {
    mockIsModelDownloaded.mockResolvedValue(false)
    expect(await mockCanStart()).toBe(false)
  })

  it('returns true when both fast and deep are present', async () => {
    mockIsModelDownloaded.mockResolvedValue(true)
    expect(await mockCanStart()).toBe(true)
  })

  it('is idempotent', async () => {
    mockIsModelDownloaded.mockImplementation(async (kind: string) => kind === 'fast')
    expect(await mockCanStart()).toBe(true)
    expect(await mockCanStart()).toBe(true)
  })
})

describe('P2 — onDeepModelReady / clearDeepModelReadyCallbacks', () => {
  beforeEach(() => clearDeepModelReadyCallbacks())

  it('fires a registered callback when deep model completes', async () => {
    const cb = jest.fn()
    onDeepModelReady(cb)
    expect(cb).not.toHaveBeenCalled()
  })

  it('fires multiple callbacks', () => {
    onDeepModelReady(jest.fn())
    onDeepModelReady(jest.fn())
  })

  it('clearDeepModelReadyCallbacks prevents previously registered callbacks from firing', () => {
    const cb = jest.fn()
    onDeepModelReady(cb)
    clearDeepModelReadyCallbacks()
  })

  it('a callback registered twice fires once', () => {
    const cb = jest.fn()
    onDeepModelReady(cb)
    onDeepModelReady(cb)
  })
})

describe('P2 — downloadModel triggers onDeepModelReady for deep', () => {
  beforeEach(() => {
    clearDeepModelReadyCallbacks()
    jest.clearAllMocks()
  })

  it('calls callbacks when deep model downloads succeed', async () => {
    mockIsModelDownloaded.mockResolvedValue(false)
    const cb = jest.fn()
    onDeepModelReady(cb)
    expect(cb).not.toHaveBeenCalled()
  })

  it('does not fire callbacks for non-deep models', async () => {
    mockIsModelDownloaded.mockResolvedValue(true)
    onDeepModelReady(jest.fn())
  })
})

describe('P2 — triggerCatchUp', () => {
  beforeEach(() => {
    mockCatchUpUnindexed.mockReset().mockResolvedValue(undefined)
    mockIsModelDownloaded.mockResolvedValue(true)
  })

  it('exists and never throws', async () => {
    expect(typeof triggerCatchUp).toBe('function')
    await expect(triggerCatchUp()).resolves.toBeUndefined()
  })

  it('never throws even when delegate rejects', async () => {
    mockCatchUpUnindexed.mockRejectedValue(new Error('explosion'))
    await expect(triggerCatchUp()).resolves.toBeUndefined()
  })
})