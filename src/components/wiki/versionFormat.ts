export interface TimelineGap {
  fromVersion: number
  toVersion: number
  missing: number
}

export function formatRelative(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || !Number.isFinite(now) || ts < 0 || ts > now) {
    return 'date unavailable'
  }
  const diff = now - ts
  const days = Math.floor(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  const date = new Date(ts)
  return Number.isNaN(date.getTime())
    ? 'date unavailable'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}