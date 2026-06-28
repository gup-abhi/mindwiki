import { useEntryStore } from '@/store/entry.store'

const store = () => useEntryStore.getState()

describe('entry.store', () => {
  beforeEach(() => store().reset())

  it('starts with an empty draft', () => {
    expect(store().draft).toEqual({ mood: null, body: '', thought: '', emotion: null })
  })

  it('sets mood, body, the optional thought, and a feeling', () => {
    store().setMood(4)
    store().setBody('a rough day')
    store().setThought('I always fail')
    store().setEmotion('Hopeful')
    expect(store().draft).toEqual({ mood: 4, body: 'a rough day', thought: 'I always fail', emotion: 'Hopeful' })
  })

  it('keeps the feeling when the mood is re-tapped to the same value', () => {
    store().setMood(4)
    store().setEmotion('Hopeful')
    store().setMood(4)
    expect(store().draft.emotion).toBe('Hopeful')
  })

  it('clears a now-mismatched feeling when the mood changes', () => {
    store().setMood(4)
    store().setEmotion('Hopeful')
    store().setMood(1) // different valence — the feeling list changes
    expect(store().draft.emotion).toBeNull()
  })

  it('reset clears the draft', () => {
    store().setMood(2)
    store().setBody('x')
    store().setEmotion('Sad')
    store().reset()
    expect(store().draft).toEqual({ mood: null, body: '', thought: '', emotion: null })
  })
})
