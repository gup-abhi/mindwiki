import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking } from 'react-native'

import { reconcileNotifications } from '@/services/notifications/orchestrator'
import { notificationPermissionState, requestNotificationPermission } from '@/services/notifications/permissions'
import { getNotificationPreferences, setNotificationPreferences } from '@/services/notifications/preferences'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/services/notifications/preferences-defaults'
import { recordReflectionPlanVersion } from '@/services/notifications/plan'
import { type NotificationPermissionState, type NotificationPreferences } from '@/services/notifications/types'
import { err } from '@/types/result'

export function useNotifications() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [permission, setPermission] = useState<NotificationPermissionState>('not-determined')
  const [busy, setBusy] = useState(false)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  const refresh = useCallback(async () => {
    try {
      const [stored, native] = await Promise.all([getNotificationPreferences(), notificationPermissionState()])
      if (stored.success) {
        preferencesRef.current = stored.data
        setPreferences(stored.data)
      }
      setPermission(native)
      if (stored.success && stored.data.enabled && (native === 'granted' || native === 'provisional')) {
        await reconcileNotifications('resume')
      }
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
    try {
      const saved = await setNotificationPreferences(next)
      if (!saved.success) return saved
      setPreferences(next)
      if (next.enabled) {
        const recorded = await recordReflectionPlanVersion(next)
        if (!recorded.success) return recorded
      }
      const reconciled = await reconcileNotifications('preferences')
      return reconciled.success ? saved : reconciled
    } catch {
      return err('NOTIF_PREFERENCES_UNAVAILABLE', 'Notification settings unavailable')
    } finally {
      setBusy(false)
    }
  }, [])

  const savePlan = useCallback(async (patch: Partial<NotificationPreferences>) => {
    setBusy(true)
    try {
      const next = {
        ...preferencesRef.current,
        ...patch,
        firstPlanSavedAt: preferencesRef.current.firstPlanSavedAt ?? (patch.enabled === false ? null : Date.now()),
      }
      const saved = await setNotificationPreferences(next)
      if (!saved.success) return saved
      setPreferences(next)
      const recorded = await recordReflectionPlanVersion(next)
      if (!recorded.success) return recorded
      const reconciled = await reconcileNotifications('preferences')
      return reconciled.success ? saved : reconciled
    } catch {
      return err('NOTIF_PREFERENCES_UNAVAILABLE', 'Notification settings unavailable')
    } finally {
      setBusy(false)
    }
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    try {
      const requested = await requestNotificationPermission()
      if (!requested.success) return requested
      setPermission(requested.data)
      if (requested.data !== 'granted' && requested.data !== 'provisional') {
        return err('NOTIF_PERMISSION_REQUIRED', 'Allow notifications in system settings before enabling reminders')
      }

      const next = {
        ...preferencesRef.current,
        enabled: true,
        firstPlanSavedAt: preferencesRef.current.firstPlanSavedAt ?? Date.now(),
      }
      const saved = await setNotificationPreferences(next)
      if (!saved.success) return saved
      setPreferences(next)
      const recorded = await recordReflectionPlanVersion(next)
      if (!recorded.success) return recorded
      const reconciled = await reconcileNotifications('preferences')
      return reconciled.success ? saved : reconciled
    } catch {
      return err('NOTIF_PREFERENCES_UNAVAILABLE', 'Notification settings unavailable')
    } finally {
      setBusy(false)
    }
  }, [])

  const allow = enable

  const openSystemSettings = useCallback(async () => {
    try { await Linking.openSettings() } catch { /* system settings unavailable */ }
  }, [])

  return { preferences, permission, busy, refresh, update, savePlan, allow, enable, openSystemSettings }
}