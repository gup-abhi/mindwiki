import { render, screen } from '@testing-library/react-native'

import { Markdown } from '@/components/wiki/Markdown'

describe('Markdown', () => {
  it('renders headings, paragraphs, and bullets and strips emphasis', () => {
    render(
      <Markdown content={'## Heading\n\nA **bold** paragraph.\n- bullet one\n- bullet two'} />
    )
    expect(screen.getByText('Heading')).toBeTruthy()
    expect(screen.getByText('A bold paragraph.')).toBeTruthy() // ** stripped
    expect(screen.getByText(/bullet one/)).toBeTruthy()
    expect(screen.getByText(/bullet two/)).toBeTruthy()
  })
})
