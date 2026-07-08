import { render, screen, fireEvent } from '@testing-library/react-native'

import { WhatChangedCard } from '@/components/home/WhatChangedCard'
import { type LineagePage } from '@/services/wiki/engine'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

describe('WhatChangedCard', () => {
  beforeEach(() => mockPush.mockReset())

  it('renders nothing when the lineage list is empty', () => {
    render(<WhatChangedCard pages={[]} />)
    expect(screen.queryByTestId('what-changed-card')).toBeNull()
  })

  it('renders nothing when lineage is null', () => {
    render(<WhatChangedCard pages={null} />)
    expect(screen.queryByTestId('what-changed-card')).toBeNull()
  })

  it('shows "Your last entry reshaped" and the page titles', () => {
    const pages: LineagePage[] = [
      { id: 'p1', title: 'Anxiety', category: 'emotion' },
      { id: 'p2', title: 'Work stress', category: 'situation' },
    ]
    render(<WhatChangedCard pages={pages} />)
    expect(screen.getByText('Your last entry reshaped')).toBeTruthy()
    expect(screen.getByText('Anxiety')).toBeTruthy()
    expect(screen.getByText('Work stress')).toBeTruthy()
  })

  it('navigates to a page when tapped', () => {
    const pages: LineagePage[] = [{ id: 'p1', title: 'Anxiety', category: 'emotion' }]
    render(<WhatChangedCard pages={pages} />)
    fireEvent.press(screen.getByText('Anxiety'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')
  })
})
