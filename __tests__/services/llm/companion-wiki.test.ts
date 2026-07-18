import { HELPER_NOTES, selectHelperNotes } from '@/services/llm/reference'
import { DISTORTIONS } from '@/services/llm/taxonomy'

describe('companion helper wiki', () => {
  it('has one note per canonical distortion plus non-distortion notes, each with triggers and guidance', () => {
    const distortionNotes = HELPER_NOTES.filter((n) => DISTORTIONS.includes(n.id as never))
    expect(distortionNotes).toHaveLength(DISTORTIONS.length)
    for (const note of distortionNotes) {
      expect(note.triggers.length).toBeGreaterThan(0)
      expect(note.content.length).toBeGreaterThan(0)
      // Distortion guidance is companion-voiced (how to respond), not a bare def.
      expect(note.content).toMatch(/gently wonder/i)
    }
  })

  it('includes a loneliness note that steers away from suggesting people (WS2.C)', () => {
    const note = HELPER_NOTES.find((n) => n.id === 'Loneliness')
    expect(note).toBeDefined()
    if (note) {
      expect(note.triggers.length).toBeGreaterThan(0)
      expect(note.content).toMatch(/do not try to fix the isolation/i)
    }
  })

  it('retrieves the note a message touches', () => {
    const notes = selectHelperNotes("if I send this wrong I'll get fired, it will be a disaster")
    expect(notes.map((n) => n.id)).toContain('Catastrophizing')
  })

  it('ranks the note with the most cue hits first', () => {
    const notes = selectHelperNotes("I always mess up — I'm such a loser, completely worthless")
    // Labeling hits twice ("i'm such a", "worthless"), Overgeneralization once.
    expect(notes[0].id).toBe('Labeling')
  })

  it('caps retrieval at two notes', () => {
    const notes = selectHelperNotes(
      "I always ruin everything, it's my fault, they think I'm an idiot, total disaster"
    )
    expect(notes.length).toBeLessThanOrEqual(2)
  })

  it('matches single-word cues on word boundaries only', () => {
    // "mustard" must not trigger the "must" cue (Should statements).
    expect(selectHelperNotes('the mustard was great').map((n) => n.id)).not.toContain(
      'Should statements'
    )
    expect(selectHelperNotes('I must not fail').map((n) => n.id)).toContain('Should statements')
  })

  it('is case-insensitive', () => {
    expect(selectHelperNotes('I ALWAYS do this').map((n) => n.id)).toContain('Overgeneralization')
  })

  it('returns nothing for a neutral message', () => {
    expect(selectHelperNotes('had a nice walk in the park today')).toEqual([])
  })

  it('selects the loneliness note for an isolation cue (WS2.C)', () => {
    expect(selectHelperNotes('i feel so alone lately').map((n) => n.id)).toContain('Loneliness')
    expect(selectHelperNotes('i am so lonely').map((n) => n.id)).toContain('Loneliness')
    expect(selectHelperNotes('i have been really isolated').map((n) => n.id)).toContain('Loneliness')
    expect(selectHelperNotes('there is nobody').map((n) => n.id)).toContain('Loneliness')
  })

  it('does not trigger "alone" on "along" or similar boundaries (WS2.C)', () => {
    expect(selectHelperNotes('i just moved along').map((n) => n.id)).not.toContain('Loneliness')
    expect(selectHelperNotes('all along the river').map((n) => n.id)).not.toContain('Loneliness')
  })

  it('caps at max notes with deterministic ordering for 2 distortions + loneliness', () => {
    // Overgeneralization ("always") hits once; Labeling ("worthless") hits via
    // 'worthless'; loneliness ("alone") hits. With max=2 the two highest-scoring
    // notes win, and the result length never exceeds the cap.
    const notes = selectHelperNotes(
      "i'm always so alone, completely worthless and nobody gets it",
      2
    )
    expect(notes.length).toBeLessThanOrEqual(2)
    // Deterministic: the same message always yields the same note set.
    const again = selectHelperNotes(
      "i'm always so alone, completely worthless and nobody gets it",
      2
    )
    expect(again.map((n) => n.id)).toEqual(notes.map((n) => n.id))
  })
})
