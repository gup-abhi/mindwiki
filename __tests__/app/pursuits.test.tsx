import { fireEvent, render, screen } from '@testing-library/react-native'

import PursuitsScreen from '@/app/pursuits'

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))

const mockSetStatus = jest.fn()
const mockRemove = jest.fn()
const mockUse = jest.fn()
jest.mock('@/hooks/usePursuits', () => ({ usePursuits: () => mockUse() }))

const pursuit = (over = {}) => ({
  id: 'p1',
  title: 'Marathon training',
  details: 'Building toward a fall race.',
  status: 'active',
  checkin_question: '',
  wiki_page_id: null,
  created_at: 0,
  updated_at: 0,
  last_mentioned_at: 0,
  last_checkin_at: null,
  ...over,
})

describe('PursuitsScreen', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockSetStatus.mockReset()
    mockRemove.mockReset()
    mockUse.mockReturnValue({ pursuits: [pursuit()], setStatus: mockSetStatus, remove: mockRemove })
  })

  it('shows the empty state with no pursuits', () => {
    mockUse.mockReturnValue({ pursuits: [], setStatus: mockSetStatus, remove: mockRemove })
    render(<PursuitsScreen />)
    expect(screen.getByText(/will show up here/)).toBeTruthy()
  })

  it('renders a pursuit with its status and details', () => {
    render(<PursuitsScreen />)
    expect(screen.getByText('Marathon training')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Building toward a fall race.')).toBeTruthy()
  })

  it('marks an active pursuit done', () => {
    render(<PursuitsScreen />)
    fireEvent.press(screen.getByTestId('pursuit-done-p1'))
    expect(mockSetStatus).toHaveBeenCalledWith('p1', 'done')
  })

  it('offers reactivate for a closed pursuit', () => {
    mockUse.mockReturnValue({
      pursuits: [pursuit({ status: 'done' })],
      setStatus: mockSetStatus,
      remove: mockRemove,
    })
    render(<PursuitsScreen />)
    fireEvent.press(screen.getByTestId('pursuit-reactivate-p1'))
    expect(mockSetStatus).toHaveBeenCalledWith('p1', 'active')
  })

  it('removes a pursuit', () => {
    render(<PursuitsScreen />)
    fireEvent.press(screen.getByTestId('pursuit-remove-p1'))
    expect(mockRemove).toHaveBeenCalledWith('p1')
  })

  it('navigates back', () => {
    render(<PursuitsScreen />)
    fireEvent.press(screen.getByTestId('pursuits-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})
