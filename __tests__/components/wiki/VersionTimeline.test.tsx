import { formatRelative } from '@/components/wiki/versionFormat'

describe('VersionTimeline date formatting', () => {
  const now = new Date(2024, 1, 15, 12, 0, 0).getTime()

  it('uses neutral wording for future timestamps', () => {
    expect(formatRelative(now + 1, now)).toBe('date unavailable')
  })

  it('uses neutral wording for invalid timestamps', () => {
    expect(formatRelative(Number.NaN, now)).toBe('date unavailable')
    expect(formatRelative(-1, now)).toBe('date unavailable')
  })

  it('keeps ordinary relative labels', () => {
    expect(formatRelative(now, now)).toBe('today')
    expect(formatRelative(now - 86_400_000, now)).toBe('yesterday')
  })
})
