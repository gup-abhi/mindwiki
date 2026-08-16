import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'

import DismissedWikiScreen from '@/app/wiki/dismissed'
import { restorePage } from '@/services/storage/wiki'
import { ok } from '@/types/result'

const mockBack = jest.fn()
const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }))

const mockRefresh = jest.fn()
const mockUse = jest.fn()
jest.mock('@/hooks/useWiki', () => ({ useDismissedPages: () => mockUse() }))

jest.mock('@/services/storage/wiki', () => ({ restorePage: jest.fn() }))
const mockRestore = restorePage as jest.Mock

describe('DismissedWikiScreen', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockPush.mockReset()
    mockRefresh.mockReset()
    mockRestore.mockReset().mockResolvedValue(ok(undefined))
    mockUse.mockReturnValue({
      pages: [{ id: 'd1', title: 'Avoidant', category: 'belief' }],
      loading: false,
      refresh: mockRefresh,
    })
  })

  it('lists dropped pages and restores one', async () => {
    render(<DismissedWikiScreen />)
    expect(screen.getByRole('header', { name: 'Dropped insights' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByText('Avoidant')).toBeTruthy()
    fireEvent.press(screen.getByTestId('dismissed-restore-d1'))
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('d1'))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('opens a dropped page for review', () => {
    render(<DismissedWikiScreen />)
    fireEvent.press(screen.getByText('Avoidant'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/d1')
  })

  it('shows an empty state when nothing is dropped', () => {
    mockUse.mockReturnValue({ pages: [], loading: false, refresh: mockRefresh })
    render(<DismissedWikiScreen />)
    expect(screen.getByText(/Nothing dropped/)).toBeTruthy()
  })

  it('navigates back', () => {
    render(<DismissedWikiScreen />)
    fireEvent.press(screen.getByTestId('dismissed-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})
