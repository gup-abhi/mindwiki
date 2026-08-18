import { useSyncExternalStore } from 'react'
import { AccessibilityInfo } from 'react-native'

let reducedMotion = true
let hydrated = false
let hydrationEpoch = 0
let nativeSubscription: { remove: () => void } | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function ensureNativeSubscription() {
  if (!nativeSubscription) {
    nativeSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      hydrated = true
      reducedMotion = enabled
      emit()
    })
  }
  if (!hydrated) {
    const epoch = hydrationEpoch
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (hydrated || epoch !== hydrationEpoch || listeners.size === 0) return
      hydrated = true
      reducedMotion = enabled
      emit()
    })
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  ensureNativeSubscription()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      nativeSubscription?.remove()
      nativeSubscription = null
      hydrationEpoch += 1
      hydrated = false
      reducedMotion = true
    }
  }
}

function getSnapshot() {
  return reducedMotion
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Reset the process-local preference cache between Jest cases. */
export function resetReducedMotionForTests(): void {
  if (process.env.NODE_ENV !== 'test') return
  nativeSubscription?.remove()
  nativeSubscription = null
  listeners.clear()
  hydrationEpoch += 1
  hydrated = false
  reducedMotion = true
}
