import { renderHook, act } from '@testing-library/react-native'

import { useJournalEntry } from '@/hooks/useJournalEntry'
import { useEntryStore } from '@/store/entry.store'
import { createEntry } from '@/services/storage/entries'
import { processEntry } from '@/services/pipeline'
import { ok } from '@/types/result'

jest.mock('@/services/storage/entries', () => ({ createEntry: jest.fn() }))
jest.mock('@/services/pipeline', () => ({ processEntry: jest.fn() }))
jest.mock('@/services/notifications/scheduler', () => ({ onEntrySaved: jest.fn() }))

const mockCreateEntry = createEntry as jest.Mock
const mockProcessEntry = processEntry as jest.Mock

describe('useJournalEntry', () => {
  beforeEach(() => {
    useEntryStore.getState().reset()
    mockCreateEntry.mockReset()
    mockProcessEntry.mockReset()
    mockProcessEntry.mockResolvedValue({
      tagged: true,
      crisis: { tier: 0, confidence: 0, keywordMatch: false },
    })
  })

  it('canSave requires both a mood and a named feeling — the body stays optional', () => {
    const { result } = renderHook(() => useJournalEntry())
    expect(result.current.canSave).toBe(false) // nothing yet
    act(() => result.current.setMood(4))
    expect(result.current.canSave).toBe(false) // mood alone is no longer enough
    act(() => result.current.setEmotion('Hopeful'))
    expect(result.current.canSave).toBe(true) // mood + feeling, even with no text
  })

  it('submit returns an error when mood is missing', async () => {
    const { result } = renderHook(() => useJournalEntry())
    act(() => result.current.setBody('something happened'))

    let res
    await act(async () => {
      res = await result.current.submit()
    })
    expect(res!.success).toBe(false)
    if (!res!.success) expect(res!.error.code).toBe('ENTRY_INVALID')
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('maps the trimmed body to situation, includes the optional thought, and resets', async () => {
    const saved = { id: 'e1', mood: 4 }
    mockCreateEntry.mockResolvedValue(ok(saved))

    const { result } = renderHook(() => useJournalEntry())
    act(() => {
      result.current.setMood(4)
      result.current.setBody('  a long rough day  ')
      result.current.setThought('I will fail')
    })

    let res
    await act(async () => {
      res = await result.current.submit()
    })

    expect(mockCreateEntry).toHaveBeenCalledWith({
      mood: 4,
      situation: 'a long rough day',
      thought: 'I will fail',
      named_emotion: null,
      behavior: null,
      closing_note: null,
    })
    expect(res!.success).toBe(true)
    if (res!.success) {
      expect(res!.data.entry).toEqual(saved)
      expect(res!.data.crisis.tier).toBe(0)
    }
    expect(mockProcessEntry).toHaveBeenCalledWith(saved) // tag + crisis
    expect(result.current.draft.mood).toBeNull() // reset
  })
})
