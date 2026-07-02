import { GUIDED_PATHS, getGuidedPath } from '@/lib/guided-paths'

describe('guided-paths catalog', () => {
  it('has unique ids', () => {
    const ids = GUIDED_PATHS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every path has a title, description, theme, and 3–5 non-empty steps', () => {
    for (const path of GUIDED_PATHS) {
      expect(path.title.trim()).not.toBe('')
      expect(path.description.trim()).not.toBe('')
      expect(path.theme.trim()).not.toBe('')
      expect(path.steps.length).toBeGreaterThanOrEqual(3)
      expect(path.steps.length).toBeLessThanOrEqual(5)
      for (const step of path.steps) expect(step.prompt.trim()).not.toBe('')
    }
  })

  it('getGuidedPath resolves a known id and returns undefined otherwise', () => {
    expect(getGuidedPath(GUIDED_PATHS[0].id)?.id).toBe(GUIDED_PATHS[0].id)
    expect(getGuidedPath('does-not-exist')).toBeUndefined()
  })
})
