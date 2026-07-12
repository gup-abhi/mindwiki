import { stripConnectionProse } from '@/services/wiki/cleanup'

describe('stripConnectionProse', () => {
  it('removes the scaffold leak line', () => {
    const raw =
      'The knowledge graph shows: Anxiety often comes up with Work, Sleep.\n' +
      'You tend to notice it most around deadlines.'
    expect(stripConnectionProse(raw)).toBe('You tend to notice it most around deadlines.')
  })

  it('removes a connection-line sentence baked into prose', () => {
    const raw =
      'You brace for the worst before meetings.\n' +
      'Anxiety often comes up with Work, Sleep.\n' +
      'Afterwards you feel the relief when it passes.'
    expect(stripConnectionProse(raw)).toBe(
      'You brace for the worst before meetings.\nAfterwards you feel the relief when it passes.'
    )
  })

  it('removes every leak variant in the multi-line block', () => {
    // The exact backfill samples: the model wrote two forms — the literal
    // instruction ("The knowledge graph shows: …") and the bare connection
    // sentence. Both must be stripped.
    const raw =
      'You tend to compare yourself to peers at work.\n' +
      'The knowledge graph shows: I am not good enough often comes up with Work, Comparison.\n' +
      'You notice the comparison sharpens when deadlines loom.\n' +
      'I am not good enough often comes up with Work, Comparison.\n' +
      'You usually recover within a day.'
    expect(stripConnectionProse(raw)).toBe(
      'You tend to compare yourself to peers at work.\n' +
        'You notice the comparison sharpens when deadlines loom.\n' +
        'You usually recover within a day.'
    )
  })

  it('leaves clean prose untouched', () => {
    const raw =
      'You tend to brace for the worst before deadlines.\n\n' +
      'Afterwards you feel the relief when it passes.'
    expect(stripConnectionProse(raw)).toBe(raw)
  })

  it('is case-insensitive on the scaffold label', () => {
    const raw =
      'THE KNOWLEDGE GRAPH SHOWS: job hunting often comes up with Work.\n' +
      'You tend to spiral after interviews.'
    expect(stripConnectionProse(raw)).toBe('You tend to spiral after interviews.')
  })

  it('trims leading and trailing whitespace from the result', () => {
    const raw = '\n\nAnxiety often comes up with Work.\nYou worry before meetings.\n   '
    expect(stripConnectionProse(raw)).toBe('You worry before meetings.')
  })
})
