import * as FileSystem from 'expo-file-system'

import {
  isModelDownloaded,
  downloadModel,
  modelLoadPath,
  modelFileUri,
} from '@/services/llm/model-manager'

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
  createDownloadResumable: jest.fn(),
}))

const fs = FileSystem as jest.Mocked<typeof FileSystem>

beforeEach(() => jest.clearAllMocks())

describe('model-manager paths', () => {
  it('loads from the same dir it downloads to, sans file:// scheme', () => {
    expect(modelFileUri('fast')).toBe('file:///docs/models/fast-model.gguf')
    expect(modelLoadPath('fast')).toBe('/docs/models/fast-model.gguf')
    expect(modelLoadPath('deep')).toBe('/docs/models/deep-model.gguf')
  })
})

describe('isModelDownloaded', () => {
  it('true only for a present non-empty file', async () => {
    fs.getInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 10 } as never)
    expect(await isModelDownloaded('fast')).toBe(true)
    fs.getInfoAsync.mockResolvedValueOnce({ exists: false } as never)
    expect(await isModelDownloaded('fast')).toBe(false)
    fs.getInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 0 } as never)
    expect(await isModelDownloaded('fast')).toBe(false)
  })
})

describe('downloadModel', () => {
  it('skips the download when the file already exists', async () => {
    fs.getInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 10 } as never)
    const res = await downloadModel('fast')
    expect(res).toEqual({ success: true, data: true })
    expect(fs.createDownloadResumable).not.toHaveBeenCalled()
  })

  it('downloads to .part then renames to the final path on success', async () => {
    fs.getInfoAsync.mockResolvedValueOnce({ exists: false } as never)
    const downloadAsync = jest.fn(async () => ({ uri: 'file:///docs/models/fast-model.gguf.part' }))
    fs.createDownloadResumable.mockReturnValueOnce({ downloadAsync } as never)

    const res = await downloadModel('fast')

    expect(res.success).toBe(true)
    expect(fs.createDownloadResumable).toHaveBeenCalledWith(
      expect.stringContaining('qwen2.5-1.5b'),
      'file:///docs/models/fast-model.gguf.part',
      expect.anything(),
      expect.any(Function)
    )
    expect(fs.moveAsync).toHaveBeenCalledWith({
      from: 'file:///docs/models/fast-model.gguf.part',
      to: 'file:///docs/models/fast-model.gguf',
    })
  })

  it('fails (no rename) when the download is interrupted', async () => {
    fs.getInfoAsync.mockResolvedValueOnce({ exists: false } as never)
    fs.createDownloadResumable.mockReturnValueOnce({
      downloadAsync: jest.fn(async () => undefined),
    } as never)

    const res = await downloadModel('fast')
    expect(res.success).toBe(false)
    expect(fs.moveAsync).not.toHaveBeenCalled()
  })
})
