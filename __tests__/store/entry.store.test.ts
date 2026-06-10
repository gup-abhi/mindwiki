import { useEntryStore } from '@/store/entry.store'

const store = () => useEntryStore.getState()

describe('entry.store', () => {
  beforeEach(() => store().reset())

  it('starts with an empty draft', () => {
    expect(store().draft).toEqual({ mood: null, body: '', thought: '' })
  })

  it('sets mood, body, and the optional thought', () => {
    store().setMood(4)
    store().setBody('a rough day')
    store().setThought('I always fail')
    expect(store().draft).toEqual({ mood: 4, body: 'a rough day', thought: 'I always fail' })
  })

  it('reset clears the draft', () => {
    store().setMood(2)
    store().setBody('x')
    store().reset()
    expect(store().draft).toEqual({ mood: null, body: '', thought: '' })
  })
})
