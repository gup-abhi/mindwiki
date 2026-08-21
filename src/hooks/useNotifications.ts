import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking } from 'react-native'

import { reconcileNotifications } from '@/services/notifications/orchestrator'
import { notificationPermissionState, requestNotificationPermission } from '@/services/notifications/permissions'
import { getNotificationPreferences, setNotificationPreferences } from '@/services/notifications/preferences'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/services/notifications/preferences-defaults'
import { recordReflectionPlanVersion } from '@/services/notifications/plan'
import { type NotificationPermissionState, type NotificationPreferences } from '@/services/notifications/types'

export function useNotifications() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [permission, setPermission] = useState<NotificationPermissionState>('not-determined')
  const [busy, setBusy] = useState(false)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  const refresh = useCallback(async () => {
    try {
      const [stored, native] = await Promise.all([getNotificationPreferences(), notificationPermissionState()])
      if (stored.success) setPreferences(stored.data)
      setPermission(native)
    } catch {
      // Settings can render in isolated tests or during a DB transition. Keep
      // safe defaults until authenticated storage is ready.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    return () => sub.remove()
  }, [refresh])

  const update = useCallback(async (patch: Partial<NotificationPreferences>) => {
    setBusy(true)
    const next = { ...preferencesRef.current, ...patch }
    let saved
    try {
      saved = await setNotificationPreferences(next)
      if (saved.success) {
        setPreferences(next)
        if (next.enabled) await recordReflectionPlanVersion(next)
        await reconcileNotifications('preferences')
      }
    } catch {
      saved = { success: false as const, error: { code: 'NOTIF_PREFERENCES_UNAVAILABLE', message: 'Notification settings unavailable' } }
    }
    setBusy(false)
    return saved
  }, [])

  const savePlan = useCallback(async (patch: Partial<NotificationPreferences>) => {
    setBusy(true)
    const next = { ...preferencesRef.current, ...patch, enabled: true, firstPlanSavedAt: preferencesRef.current.firstPlanSavedAt ?? Date.now() }
    const saved = await setNotificationPreferences(next)
    if (saved.success) {
      setPreferences(next)
      await recordReflectionPlanVersion(next)
      await reconcileNotifications('preferences')
    }
    setBusy(false)
    return saved
  }, [])

  const allow = useCallback(async () => {
    setBusy(true)
    const requested = await requestNotificationPermission()
    if (requested.success) {
      setPermission(requested.data)
      if (requested.data === 'granted' || requested.data === 'provisional') await reconcileNotifications('preferences')
    }
    setBusy(false)
    return requested
  }, [])

  const enable = allow

  const openSystemSettings = useCallback(async () => {
    try { await Linking.openSettings() } catch { /* system settings unavailable */ }
  }, [])

  return { preferences, permission, busy, refresh, update, savePlan, allow, enable, openSystemSettings }
}