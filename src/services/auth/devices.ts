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
 * Remove a device from the account's list by id — lets the owner clear a stale
 * or signed-out device (including old rows from before per-device logout, which
 * can't auto-remove). Requires a session.
 */
export async function removeDevice(id: string): Promise<Result<void>> {
  try {
    const res = await authenticatedFetch('/auth/devices/remove', {
      method: 'POST',
      body: JSON.stringify({ device_id: id }),
    })
    if (!res.success) return res
    if (!res.data.ok) return err('DEVICE_REMOVE_FAILED', `Remove failed (${res.data.status})`)
    return ok(undefined)
  } catch (e) {
    return err('DEVICE_REMOVE_FAILED', 'Remove failed', e)
  }
}
