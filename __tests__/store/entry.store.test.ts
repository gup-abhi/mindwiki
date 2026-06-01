import { useEntryStore, TOTAL_STEPS } from '@/store/entry.store'

const store = () => useEntryStore.getState()

describe('entry.store', () => {
  beforeEach(() => {
    store().reset()
  })

  it('starts at step 1 with an empty draft', () => {
    expect(store().step).toBe(1)
    expect(store().draft.mood).toBeNull()
    expect(store().draft.situation).toBe('')
  })

  it('sets mood and draft fields', () => {
    store().setMood(4)
    store().setField('situation', 'a meeting')
    expect(store().draft.mood).toBe(4)
    expect(store().draft.situation).toBe('a meeting')
  })

  it('advances and goes back without exceeding bounds', () => {
    store().goBack()
    expect(store().step).toBe(1) // clamped at 1

    for (let i = 0; i < TOTAL_STEPS + 2; i++) store().goNext()
    expect(store().step).toBe(TOTAL_STEPS) // clamped at TOTAL_STEPS

    store().goBack()
    expect(store().step).toBe(TOTAL_STEPS - 1)
  })

  it('goToStep ignores out-of-range values', () => {
    store().goToStep(3)
    expect(store().step).toBe(3)
    store().goToStep(99)
    expect(store().step).toBe(3)
    store().goToStep(0)
    expect(store().step).toBe(3)
  })

  it('reset clears the draft and returns to step 1', () => {
    store().setMood(2)
    store().setField('thought', 'x')
    store().goToStep(4)

    store().reset()

    expect(store().step).toBe(1)
    expect(store().draft.mood).toBeNull()
    expect(store().draft.thought).toBe('')
  })
})
