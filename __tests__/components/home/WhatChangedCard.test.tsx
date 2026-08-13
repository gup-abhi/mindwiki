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

  it('shows the confirmed contribution and page titles', () => {
    const pages: LineagePage[] = [
      { id: 'p1', title: 'Anxiety', category: 'emotion' },
      { id: 'p2', title: 'Work stress', category: 'situation' },
    ]
    render(<WhatChangedCard pages={pages} />)
    expect(screen.getByText('This reflection contributed to…')).toBeTruthy()
    expect(screen.getByText('Anxiety')).toBeTruthy()
    expect(screen.getByText('Work stress')).toBeTruthy()
  })

  it('shows pending synthesis without a causal claim', () => {
    render(<WhatChangedCard pages={[]} pending />)
    expect(screen.getByTestId('what-changed-pending')).toBeTruthy()
    expect(screen.getByText('Private synthesis in progress')).toBeTruthy()
    expect(screen.queryByText('This reflection contributed to…')).toBeNull()
  })

  it('renders no card when there is no receipt-backed page', () => {
    render(<WhatChangedCard pages={[]} />)
    expect(screen.queryByTestId('what-changed-card')).toBeNull()
    expect(screen.queryByTestId('what-changed-pending')).toBeNull()
  })

  it('renders no card for null lineage unless synthesis is pending', () => {
    render(<WhatChangedCard pages={null} />)
    expect(screen.queryByTestId('what-changed-card')).toBeNull()
    expect(screen.queryByTestId('what-changed-pending')).toBeNull()
  })

  it('navigates to a page when tapped', () => {
    const pages: LineagePage[] = [{ id: 'p1', title: 'Anxiety', category: 'emotion' }]
    render(<WhatChangedCard pages={pages} />)
    fireEvent.press(screen.getByText('Anxiety'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')
  })
})
