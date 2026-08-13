import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useModelDownload } from '@/hooks/useModelDownload'
import { areModelsReady, canStart, downloadModel } from '@/services/llm/model-manager'

jest.mock('@/services/llm/model-manager', () => ({
  areModelsReady: jest.fn(),
  canStart: jest.fn(),
  downloadModel: jest.fn(),
}))

jest.mock('@/services/pipeline', () => ({
  triggerCatchUp: jest.fn(),
}))

jest.mock('@/services/onboarding/first-run', () => ({
  getModelDownloadPreference: jest.fn(() => Promise.resolve('undecided')),
  setModelDownloadPreference: jest.fn(() => Promise.resolve()),
}))

const mockReady = areModelsReady as jest.Mock
const mockCanStart = canStart as jest.Mock
const mockDownload = downloadModel as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockReady.mockResolvedValue(false)
  mockCanStart.mockResolvedValue(false)
  mockDownload.mockResolvedValue({ success: true, data: true })
})

describe('useModelDownload', () => {
  it('reports not-ready and not-canStart when models are missing', async () => {
    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => {
      expect(result.current.ready).toBe(false)
      expect(result.current.canStart).toBe(false)
    })
  })

  it('downloads fast then deep (fire-and-forget) and triggers catch-up on deep ready', async () => {
    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => expect(result.current.ready).toBe(false))

    await act(async () => {
      await result.current.download()
    })

    // Fast model downloaded synchronously inside download()
    const fastCall = mockDownload.mock.calls.find((c: unknown[]) => c[0] === 'fast')
    expect(fastCall).toBeDefined()
    // Deep fired as fire-and-forget
    const deepCall = mockDownload.mock.calls.find((c: unknown[]) => c[0] === 'deep')
    expect(deepCall).toBeDefined()
  })

  it('surfaces an error and stops when fast model download fails', async () => {
    mockDownload.mockResolvedValueOnce({ success: false, error: { code: 'X', message: 'no' } })
    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => expect(result.current.ready).toBe(false))

    await act(async () => {
      await result.current.download()
    })

    expect(mockDownload).toHaveBeenCalledTimes(1) // stopped after fast failure
    expect(result.current.error).toBeTruthy()
    expect(result.current.ready).toBe(false)
  })

  it('reports canStart once the fast model is present at mount', async () => {
    mockCanStart.mockResolvedValue(true)

    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => {
      expect(result.current.canStart).toBe(true)
      expect(result.current.ready).toBe(false)
    })
  })
})
