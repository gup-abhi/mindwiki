import { DEFAULT_ACTION_IDENTIFIER, type NotificationResponse } from 'expo-notifications'

import { type Result } from '@/types/result'
import { isNotificationKind } from './policy'

interface NotificationResponseHandlerDeps {
  handleCandidate(candidateId: string, action?: 'default' | 'reflect'): Promise<Result<string | null>>
  navigate(route: string): void
  clearResponse(): Promise<void>
}

/** Handles each native response identifier once per mounted authenticated
 * session. Every response — valid, malformed, duplicate, stale, or failed — is
 * cleared from native cache so it cannot block a later stimulus. */
export function createNotificationResponseHandler(
  deps: NotificationResponseHandlerDeps
): (response: NotificationResponse | null) => void {
  const handledIdentifiers = new Set<string>()
  return (response) => {
    if (!response) return
    const identifier = response.notification.request.identifier
    if (handledIdentifiers.has(identifier)) {
      void deps.clearResponse()
      return
    }
    handledIdentifiers.add(identifier)
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    const candidateId = data?.candidateId
    const kind = data?.kind
    if (typeof candidateId !== 'string' || !isNotificationKind(kind)) {
      void deps.clearResponse()
      return
    }
    const actionIdentifier = response.actionIdentifier
    const action = actionIdentifier === 'REFLECT'
      ? 'reflect'
      : actionIdentifier == null || actionIdentifier === DEFAULT_ACTION_IDENTIFIER
        ? 'default'
        : null
    if (!action) {
      void deps.clearResponse()
      return
    }
    void (action === 'default'
      ? deps.handleCandidate(candidateId)
      : deps.handleCandidate(candidateId, action))
      .then((result) => {
        if (result.success && result.data) deps.navigate(result.data)
      })
      .finally(() => deps.clearResponse())
  }
}