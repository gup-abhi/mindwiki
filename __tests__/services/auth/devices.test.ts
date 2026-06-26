import { listDevices, removeDevice } from '@/services/auth/devices'
import { authenticatedFetch } from '@/services/auth/api-client'

jest.mock('@/services/auth/api-client', () => ({ authenticatedFetch: jest.fn() }))
const mockFetch = authenticatedFetch as jest.Mock

describe('listDevices', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the device list on success', async () => {
    const devices = [{ id: 'd1', label: 'Pixel', platform: 'android', paired_at: 1 }]
    mockFetch.mockResolvedValue({ success: true, data: { ok: true, json: async () => ({ devices }) } })
    const res = await listDevices()
    expect(res).toEqual({ success: true, data: devices })
  })

  it('fails on a non-ok response', async () => {
    mockFetch.mockResolvedValue({ success: true, data: { ok: false, status: 500 } })
    const res = await listDevices()
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('DEVICES_FAILED')
  })
})

describe('removeDevice', () => {
  beforeEach(() => jest.clearAllMocks())

  it('posts the device id to the remove endpoint', async () => {
    mockFetch.mockResolvedValue({ success: true, data: { ok: true } })
    const res = await removeDevice('d1')
    expect(res.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/auth/devices/remove', {
      method: 'POST',
      body: JSON.stringify({ device_id: 'd1' }),
    })
  })

  it('fails on a non-ok response', async () => {
    mockFetch.mockResolvedValue({ success: true, data: { ok: false, status: 500 } })
    const res = await removeDevice('d1')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('DEVICE_REMOVE_FAILED')
  })
})
