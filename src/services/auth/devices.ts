import { type Result, ok, err } from '@/types/result'

import { authenticatedFetch } from './api-client'

export interface PairedDevice {
  id: string
  label: string
  platform: string
  paired_at: number
}

/**
 * List the devices that have paired with this account (newest first), so the
 * owner can review them and spot anything they didn't authorize. Requires a
 * session (authenticatedFetch handles token refresh).
 */
export async function listDevices(): Promise<Result<PairedDevice[]>> {
  try {
    const res = await authenticatedFetch('/auth/devices', { method: 'GET' })
    if (!res.success) return res
    if (!res.data.ok) return err('DEVICES_FAILED', `Devices failed (${res.data.status})`)
    const data = (await res.data.json()) as { devices: PairedDevice[] }
    return ok(data.devices)
  } catch (e) {
    return err('DEVICES_FAILED', 'Devices failed', e)
  }
}

/**
 * Sign another device out by id: the server invalidates that device's session
 * (it's forced back to login within ~15 min) and drops it from the list. Also
 * clears stale/legacy rows that have no session to revoke. Requires a session.
 */
export async function logoutDevice(id: string, currentDeviceId?: string | null): Promise<Result<void>> {
  if (!id || (currentDeviceId && id === currentDeviceId)) {
    return err('CURRENT_DEVICE', 'This device cannot be signed out here')
  }
  try {
    const res = await authenticatedFetch(`/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.success) return res
    if (!res.data.ok) return err('DEVICE_LOGOUT_FAILED', `Logout failed (${res.data.status})`)
    return ok(undefined)
  } catch (e) {
    return err('DEVICE_LOGOUT_FAILED', 'Logout failed', e)
  }
}
