import { CATEGORY_ORDER, categoryKey, categoryLabel } from '@/services/wiki/categories'

describe('wiki categories', () => {
  it('recognizes belief and behavior as their own buckets (not "other")', () => {
    // Regression: belief/behavior pages used to fall through to "other" because
    // they were missing from the category map when belief nodes shipped.
    expect(categoryKey('belief')).toBe('belief')
    expect(categoryKey('behavior')).toBe('behavior')
    expect(categoryLabel('belief')).toBe('Beliefs')
    expect(categoryLabel('behavior')).toBe('Behaviours')
    expect(CATEGORY_ORDER).toEqual(expect.arrayContaining(['belief', 'behavior']))
  })

  it('still maps the known engine categories and falls back to "other"', () => {
    for (const c of ['emotion', 'distortion', 'theme', 'person', 'place', 'activity']) {
      expect(categoryKey(c)).toBe(c)
    }
    expect(categoryKey(null)).toBe('other')
    expect(categoryKey('something-unknown')).toBe('other')
  })
})
