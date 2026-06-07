import { fireEvent, render, screen } from '@testing-library/react-native'

import { RecoverySetupCard } from '@/components/auth/RecoverySetupCard'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'

jest.mock('@/hooks/useRecoverySetup', () => ({ useRecoverySetup: jest.fn() }))

const mockHook = useRecoverySetup as jest.Mock
const base = { needsSetup: false, phrase: null, busy: false, error: null, setup: jest.fn(), done: jest.fn() }

beforeEach(() => jest.clearAllMocks())

describe('RecoverySetupCard', () => {
  it('renders nothing when recovery is already set up', () => {
    mockHook.mockReturnValue({ ...base, needsSetup: false })
    const { toJSON } = render(<RecoverySetupCard />)
    expect(toJSON()).toBeNull()
  })

  it('shows the nudge and triggers setup on press', () => {
    const setup = jest.fn()
    mockHook.mockReturnValue({ ...base, needsSetup: true, setup })
    render(<RecoverySetupCard />)
    expect(screen.getByText('Protect your account')).toBeTruthy()
    fireEvent.press(screen.getByTestId('recovery-setup-card'))
    expect(setup).toHaveBeenCalled()
  })

  it('shows the phrase in a modal once generated', () => {
    mockHook.mockReturnValue({ ...base, phrase: 'alpha bravo charlie' })
    render(<RecoverySetupCard />)
    expect(screen.getByText('Save your recovery phrase')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
  })
})
