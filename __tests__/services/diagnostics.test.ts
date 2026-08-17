import { parseDiagnosticEvent } from '@/services/diagnostics'

describe('parseDiagnosticEvent', () => {
  it('accepts the allowlisted aggregate diagnostic fields', () => {
    expect(parseDiagnosticEvent({
      appVersion: '1.2.3',
      platform: 'android',
      subsystem: 'sync',
      code: 'SYNC_PULL_FAILED',
      durationMs: 120,
      count: 2,
    })).toEqual({
      appVersion: '1.2.3',
      platform: 'android',
      subsystem: 'sync',
      code: 'SYNC_PULL_FAILED',
      durationMs: 120,
      count: 2,
    })
  })

  it.each([
    ['authored content', { appVersion: '1.2.3', platform: 'ios', subsystem: 'sync', code: 'entry text' }],
    ['route identifier', { appVersion: '1.2.3', platform: 'ios', subsystem: 'sync', code: 'entry/abc' }],
    ['unknown field', { appVersion: '1.2.3', platform: 'ios', subsystem: 'sync', code: 'SYNC_FAILED', accountId: 'abc' }],
    ['negative duration', { appVersion: '1.2.3', platform: 'ios', subsystem: 'sync', code: 'SYNC_FAILED', durationMs: -1 }],
    ['fractional count', { appVersion: '1.2.3', platform: 'ios', subsystem: 'sync', code: 'SYNC_FAILED', count: 1.5 }],
  ])('rejects %s', (_reason, event) => {
    expect(parseDiagnosticEvent(event)).toBeNull()
  })
})
