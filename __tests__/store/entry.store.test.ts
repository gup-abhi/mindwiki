import { useEntryStore } from '@/store/entry.store'

const store = () => useEntryStore.getState()

describe('entry.store', () => {
  beforeEach(() => store().reset())

  it('starts with an empty draft', () => {
    expect(store().draft).toEqual({ mood: null, energy: null, body: '', thought: '', emotion: null })
  })

  it('sets the affect grid point, body, the optional thought, and a feeling', () => {
    store().setAffect(4, 5) // pleasantness 4, energy 5
    store().setBody('a rough day')
    store().setThought('I always fail')
    store().setEmotion('Excited')
    expect(store().draft).toEqual({
      mood: 4,
      energy: 5,
      body: 'a rough day',
      thought: 'I always fail',
      emotion: 'Excited',
    })
  })

  it('keeps the feeling when the same grid cell is re-tapped', () => {
    store().setAffect(4, 5)
    store().setEmotion('Excited')
    store().setAffect(4, 5)
    expect(store().draft.emotion).toBe('Excited')
  })

  it('clears a now-mismatched feeling when the grid point changes', () => {
    store().setAffect(4, 5)
    store().setEmotion('Excited')
    store().setAffect(1, 2) // a different quadrant — the feeling list changes
    expect(store().draft.emotion).toBeNull()
  })

  it('reset clears the draft', () => {
    store().setAffect(2, 1)
    store().setBody('x')
    store().setEmotion('Sad')
    store().reset()
    expect(store().draft).toEqual({ mood: null, energy: null, body: '', thought: '', emotion: null })
  })
})
