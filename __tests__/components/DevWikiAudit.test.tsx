import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { DevWikiAudit } from '@/components/DevWikiAudit'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { listNodes, listEdges } from '@/services/storage/graph'
import { getMaintenanceState } from '@/services/storage/maintenance-state'
import { getSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { listPages } from '@/services/storage/wiki'
import { listAllSourceEntriesForPage } from '@/services/wiki/reground-evidence'
import { runBeliefMaintenance } from '@/services/wiki/belief-maintenance'
import { scanReGroundDuePages } from '@/services/wiki/engine'
import { runStartupMaintenanceForDev } from '@/services/storage/bootstrap'

jest.mock('@/services/llm/model-manager', () => ({ isModelDownloaded: jest.fn() }))
jest.mock('@/services/storage/graph', () => ({ listNodes: jest.fn(), listEdges: jest.fn() }))
jest.mock('@/services/storage/maintenance-state', () => ({ getMaintenanceState: jest.fn() }))
jest.mock('@/services/storage/settings', () => ({ getSetting: jest.fn() }))
jest.mock('@/services/storage/db', () => ({ getDb: jest.fn() }))
jest.mock('@/services/storage/wiki', () => ({ listPages: jest.fn() }))
jest.mock('@/services/wiki/reground-evidence', () => ({ listAllSourceEntriesForPage: jest.fn() }))
jest.mock('@/services/wiki/belief-maintenance', () => ({ runBeliefMaintenance: jest.fn() }))
jest.mock('@/services/wiki/engine', () => ({ scanReGroundDuePages: jest.fn() }))
jest.mock('@/services/storage/bootstrap', () => ({ runStartupMaintenanceForDev: jest.fn() }))

const mockIsModelDownloaded = isModelDownloaded as jest.Mock
const mockListNodes = listNodes as jest.Mock
const mockListEdges = listEdges as jest.Mock
const mockGetMaintenanceState = getMaintenanceState as jest.Mock
const mockGetSetting = getSetting as jest.Mock
const mockGetDb = getDb as jest.Mock
const mockListPages = listPages as jest.Mock
const mockListSources = listAllSourceEntriesForPage as jest.Mock
const mockRunBeliefMaintenance = runBeliefMaintenance as jest.Mock
const mockScanReGround = scanReGroundDuePages as jest.Mock
const mockRunStartupMaintenance = runStartupMaintenanceForDev as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockIsModelDownloaded.mockResolvedValue(true)
  mockListNodes.mockResolvedValue({ success: true, data: [{ id: 'n1' }] })
  mockListEdges.mockResolvedValue({ success: true, data: [{ id: 'e1' }] })
  mockGetMaintenanceState.mockResolvedValue({
    success: true,
    data: {
      status: 'idle',
      source_generation: 2,
      processed_generation: 2,
    },
  })
  mockGetSetting.mockResolvedValue({ success: true, data: '3' })
  mockGetDb.mockReturnValue({
    execute: jest.fn().mockResolvedValue({ rows: [{ count: 4 }], rowsAffected: 0 }),
  })
  mockListPages.mockResolvedValue({
    success: true,
    data: [{
      id: 'p1',
      title: 'Work',
      category: 'theme',
      content: '',
      entry_count: 10,
      regrounded_upto: 0,
      version: 1,
      created_at: 0,
      updated_at: 0,
      dismissed_at: null,
      corrected_at: null,
      merged_into: null,
    }],
  })
  mockListSources.mockResolvedValue({ success: true, data: [] })
  mockRunStartupMaintenance.mockResolvedValue(undefined)
  mockScanReGround.mockResolvedValue({ success: true, data: 2 })
  mockRunBeliefMaintenance.mockResolvedValue({
    success: true,
    data: { repairedClusters: 1 },
  })
})

describe('DevWikiAudit', () => {
  it('runs count-only refresh and shows device state', async () => {
    render(<DevWikiAudit />)

    fireEvent.press(screen.getByTestId('dev-wiki-audit-refresh'))

    await waitFor(() => expect(screen.getByText(/Models fast yes/)).toBeTruthy())
    expect(screen.getByText(/Pages 1 · due 0 · sources 0/)).toBeTruthy()
    expect(screen.getByText(/Receipts 4 · graph nodes 1 · edges 1/)).toBeTruthy()
    expect(screen.getByText(/Belief idle · generation 2\/2/)).toBeTruthy()
  })

  it('runs production maintenance actions from settings controls', async () => {
    render(<DevWikiAudit />)

    fireEvent.press(screen.getByTestId('dev-wiki-audit-maintenance'))
    await waitFor(() => expect(mockRunStartupMaintenance).toHaveBeenCalledTimes(1))

    fireEvent.press(screen.getByTestId('dev-wiki-audit-reground'))
    await waitFor(() => expect(mockScanReGround).toHaveBeenCalledTimes(1))

    fireEvent.press(screen.getByTestId('dev-wiki-audit-belief'))
    await waitFor(() => expect(mockRunBeliefMaintenance).toHaveBeenCalledTimes(1))
  })
})
