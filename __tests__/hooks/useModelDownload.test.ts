import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useModelDownload } from '@/hooks/useModelDownload'
import { areModelsReady, downloadModel } from '@/services/llm/model-manager'

jest.mock('@/services/llm/model-manager', () => ({
  areModelsReady: jest.fn(),
  downloadModel: jest.fn(),
}))

const mockReady = areModelsReady as jest.Mock
const mockDownload = downloadModel as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockReady.mockResolvedValue(false)
  mockDownload.mockResolvedValue({ success: true, data: true })
})

describe('useModelDownload', () => {
  it('reports not-ready when models are missing', async () => {
    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => expect(result.current.ready).toBe(false))
  })

  it('downloads both models then marks ready', async () => {
    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => expect(result.current.ready).toBe(false))

    await act(async () => {
      await result.current.download()
    })

    expect(mockDownload).toHaveBeenCalledTimes(2)
    expect(mockDownload).toHaveBeenNthCalledWith(1, 'fast', expect.any(Function))
    expect(mockDownload).toHaveBeenNthCalledWith(2, 'deep', expect.any(Function))
    expect(result.current.ready).toBe(true)
    expect(result.current.progress).toBe(1)
  })

  it('surfaces an error and stops when a download fails', async () => {
    mockDownload.mockResolvedValueOnce({ success: false, error: { code: 'X', message: 'no' } })
    const { result } = renderHook(() => useModelDownload())
    await waitFor(() => expect(result.current.ready).toBe(false))

    await act(async () => {
      await result.current.download()
    })

    expect(mockDownload).toHaveBeenCalledTimes(1) // stopped after the failure
    expect(result.current.error).toBeTruthy()
    expect(result.current.ready).toBe(false)
  })
})
