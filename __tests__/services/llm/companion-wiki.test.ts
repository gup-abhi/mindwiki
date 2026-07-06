import { HELPER_NOTES, selectHelperNotes } from '@/services/llm/reference'
import { DISTORTIONS } from '@/services/llm/taxonomy'

describe('companion helper wiki', () => {
  it('has one note per canonical distortion, each with triggers and guidance', () => {
    expect(HELPER_NOTES).toHaveLength(DISTORTIONS.length)
    for (const note of HELPER_NOTES) {
      expect(DISTORTIONS).toContain(note.id)
      expect(note.triggers.length).toBeGreaterThan(0)
      expect(note.content.length).toBeGreaterThan(0)
      // Guidance is companion-voiced (how to respond), not a bare definition.
      expect(note.content).toMatch(/gently wonder/i)
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
})
