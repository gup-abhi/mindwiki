import { useWikiStore } from '@/store/wiki.store'

const store = () => useWikiStore.getState()

describe('wiki.store', () => {
  beforeEach(() => useWikiStore.setState({ pending: 0 }))

  it('begin/end track in-flight syntheses', () => {
    expect(store().pending).toBe(0)
    store().begin()
    store().begin()
    expect(store().pending).toBe(2)
    store().end()
    expect(store().pending).toBe(1)
  })

  it('end never goes below zero', () => {
    store().end()
    expect(store().pending).toBe(0)
  })
})
