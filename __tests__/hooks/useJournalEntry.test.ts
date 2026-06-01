import { renderHook, act } from '@testing-library/react-native'

import { useJournalEntry } from '@/hooks/useJournalEntry'
import { useEntryStore } from '@/store/entry.store'
import { createEntry } from '@/services/storage/entries'
import { processEntry } from '@/services/pipeline'
import { ok } from '@/types/result'

jest.mock('@/services/storage/entries', () => ({
  createEntry: jest.fn(),
}))
jest.mock('@/services/pipeline', () => ({ processEntry: jest.fn() }))

const mockCreateEntry = createEntry as jest.Mock
const mockProcessEntry = processEntry as jest.Mock

describe('useJournalEntry', () => {
  beforeEach(() => {
    useEntryStore.getState().reset()
    mockCreateEntry.mockReset()
    mockProcessEntry.mockReset()
  })

  it('blocks advancing past required steps until they are filled', () => {
    const { result } = renderHook(() => useJournalEntry())

    expect(result.current.canAdvance).toBe(false) // step 1 needs mood
    act(() => result.current.next())
    expect(result.current.step).toBe(1) // did not advance

    act(() => result.current.setMood(4))
    expect(result.current.canAdvance).toBe(true)
    act(() => result.current.next())
    expect(result.current.step).toBe(2)
  })

  it('allows skipping the optional steps (4 and 5)', () => {
    const { result } = renderHook(() => useJournalEntry())

    act(() => {
      result.current.setMood(3)
      result.current.setField('situation', 's')
      result.current.setField('thought', 't')
    })
    act(() => result.current.next()) // 1->2
    act(() => result.current.next()) // 2->3
    act(() => result.current.next()) // 3->4
    expect(result.current.step).toBe(4)
    act(() => result.current.skip()) // 4->5 (optional)
    expect(result.current.step).toBe(5)
    expect(result.current.isLastStep).toBe(true)
  })

  it('submit returns an error when mood is missing', async () => {
    const { result } = renderHook(() => useJournalEntry())

    let res
    await act(async () => {
      res = await result.current.submit()
    })
    expect(res!.success).toBe(false)
    if (!res!.success) expect(res!.error.code).toBe('ENTRY_INVALID')
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('submit builds the entry from the draft, calls createEntry, and resets on success', async () => {
    const saved = { id: 'e1', mood: 4 }
    mockCreateEntry.mockResolvedValue(ok(saved))

    const { result } = renderHook(() => useJournalEntry())
    act(() => {
      result.current.setMood(4)
      result.current.setField('situation', 'a meeting')
      result.current.setField('thought', 'I will fail')
      result.current.setField('behavior', '  ') // whitespace -> null
    })

    let res
    await act(async () => {
      res = await result.current.submit()
    })

    expect(mockCreateEntry).toHaveBeenCalledWith({
      mood: 4,
      situation: 'a meeting',
      thought: 'I will fail',
      behavior: null,
      closing_note: null,
    })
    expect(res!.success).toBe(true)
    expect(mockProcessEntry).toHaveBeenCalledWith(saved) // background tag + crisis
    expect(result.current.step).toBe(1) // reset
    expect(result.current.draft.mood).toBeNull()
  })
})
