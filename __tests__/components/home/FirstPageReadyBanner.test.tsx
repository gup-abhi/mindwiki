import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'

import { FirstPageReadyBanner } from '@/components/home/FirstPageReadyBanner'
import { clearFirstRunPageReady, resolveFirstRunPageReady } from '@/services/onboarding/first-run'

const mockPush = jest.fn()
const mockResolve = resolveFirstRunPageReady as jest.Mock
const mockClear = clearFirstRunPageReady as jest.Mock

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    const React = require('react') as typeof import('react')
    React.useEffect(effect, [])
  },
}))

jest.mock('@/services/onboarding/first-run', () => ({
  resolveFirstRunPageReady: jest.fn(),
  clearFirstRunPageReady: jest.fn(),
}))

describe('FirstPageReadyBanner', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockResolve.mockReset().mockResolvedValue({ id: 'p1', title: 'Anxiety' })
    mockClear.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the receipt available when Home focuses and remounts', async () => {
    const first = render(<FirstPageReadyBanner />)
    await waitFor(() => expect(screen.getByTestId('first-page-ready-banner')).toBeTruthy())
    first.unmount()

    render(<FirstPageReadyBanner />)
    await waitFor(() => expect(screen.getByTestId('first-page-ready-banner')).toBeTruthy())
    expect(mockResolve).toHaveBeenCalledTimes(2)
    expect(mockClear).not.toHaveBeenCalled()
  })

  it('clears before opening the opaque page route', async () => {
    render(<FirstPageReadyBanner />)
    await waitFor(() => expect(screen.getByTestId('first-page-ready-open')).toBeTruthy())

    fireEvent.press(screen.getByTestId('first-page-ready-open'))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wiki/p1',
      params: { firstRun: '1' },
    }))
    expect(mockClear).toHaveBeenCalledTimes(1)
  })

  it('clears when dismissed without navigating', async () => {
    render(<FirstPageReadyBanner />)
    await waitFor(() => expect(screen.getByTestId('first-page-ready-dismiss')).toBeTruthy())

    fireEvent.press(screen.getByTestId('first-page-ready-dismiss'))
    await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders a safe fallback title supplied by the resolver', async () => {
    mockResolve.mockResolvedValue({ id: 'missing', title: 'Your first insight' })
    render(<FirstPageReadyBanner />)
    await waitFor(() => expect(screen.getByText('Your first insight')).toBeTruthy())
  })
})
