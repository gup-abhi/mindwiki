import {
  invalidateSessionWork,
  resetSessionWorkForTests,
  resumeSessionWork,
  startSessionWork,
  waitForSessionWork,
} from '@/services/auth/session-work'

describe('session work barrier', () => {
  beforeEach(() => {
    resetSessionWorkForTests()
  })

  it('invalidates existing leases and blocks new work until resumed', () => {
    const lease = startSessionWork()
    expect(lease).not.toBeNull()
    invalidateSessionWork()

    expect(lease?.checkpoint()).toBe(false)
    expect(startSessionWork()).toBeNull()

    resumeSessionWork()
    const next = startSessionWork()
    expect(next?.checkpoint()).toBe(true)
    next?.done()
    lease?.done()
  })

  it('waits for active work to finish', async () => {
    const lease = startSessionWork()
    let finished = false
    const waiting = waitForSessionWork(100).then(() => {
      finished = true
    })

    await Promise.resolve()
    expect(finished).toBe(false)
    lease?.done()
    await waiting
    expect(finished).toBe(true)
  })

  it('does not release a lease twice', async () => {
    const lease = startSessionWork()
    lease?.done()
    lease?.done()
    await expect(waitForSessionWork(10)).resolves.toBeUndefined()
  })
})
