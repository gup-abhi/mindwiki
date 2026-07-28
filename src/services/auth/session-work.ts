/**
 * Account-scoped background-work barrier. Long inference may finish after logout,
 * but its lease checkpoint must fail before any persistence phase.
 */
export interface SessionWorkLease {
  checkpoint(): boolean
  done(): void
}

let generation = 0
let invalidated = false
let active = 0
let idleWaiters: (() => void)[] = []

export function startSessionWork(): SessionWorkLease | null {
  if (invalidated) return null
  const captured = generation
  active++
  let released = false
  return {
    checkpoint: () => !invalidated && generation === captured,
    done: () => {
      if (released) return
      released = true
      active--
      if (active === 0) {
        const waiters = idleWaiters
        idleWaiters = []
        waiters.forEach((resolve) => resolve())
      }
    },
  }
}

/** Stop admitting work and invalidate all leases. */
export function invalidateSessionWork(): void {
  invalidated = true
  generation++
}

/** Allow work after a new authenticated DB session opens. */
export function resumeSessionWork(): void {
  invalidated = false
  generation++
}

export function waitForSessionWork(timeoutMs: number): Promise<void> {
  if (active === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const index = idleWaiters.indexOf(finish)
      if (index >= 0) idleWaiters.splice(index, 1)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    idleWaiters.push(finish)
  })
}

export function resetSessionWorkForTests(): void {
  generation = 0
  invalidated = false
  active = 0
  idleWaiters = []
}