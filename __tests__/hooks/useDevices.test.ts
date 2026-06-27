import { renderHook, waitFor } from '@testing-library/react-native'

import { useDevices } from '@/hooks/useDevices'
import { listDevices, logoutDevice } from '@/services/auth/devices'
import { getDeviceId } from '@/services/auth/device-id'

jest.mock('@/services/auth/devices', () => ({
  listDevices: jest.fn(),
  logoutDevice: jest.fn(),
}))
jest.mock('@/services/auth/device-id', () => ({ getDeviceId: jest.fn() }))

const mockList = listDevices as jest.Mock
const mockLogout = logoutDevice as jest.Mock
const mockGetId = getDeviceId as jest.Mock

const dev = (id: string, label: string) => ({ id, label, platform: 'ios', paired_at: 1 })

beforeEach(() => {
  jest.clearAllMocks()
  mockLogout.mockResolvedValue({ success: true, data: undefined })
})

it('orders the current device first', async () => {
  mockGetId.mockResolvedValue('d2')
  mockList.mockResolvedValue({ success: true, data: [dev('d1', 'A'), dev('d2', 'B'), dev('d3', 'C')] })

  const { result } = renderHook(() => useDevices())

  await waitFor(() => expect(result.current.devices).toHaveLength(3))
  await waitFor(() => expect(result.current.currentDeviceId).toBe('d2'))
  expect(result.current.devices.map((d) => d.id)).toEqual(['d2', 'd1', 'd3'])
})
