import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'

import PathRunnerScreen from '@/app/paths/[id]'
import { GUIDED_PATHS } from '@/lib/guided-paths'

const mockReplace = jest.fn()
const mockBack = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => ({ id: 'overwhelmed' }),
}))
jest.mock('@/lib/haptics', () => ({ haptics: { success: jest.fn(), light: jest.fn() } }))

// A controllable useGuidedPath so the screen can be driven step-by-step.
const path = GUIDED_PATHS.find((p) => p.id === 'overwhelmed')!
let mockHook: Record<string, unknown>
jest.mock('@/hooks/useGuidedPath', () => ({ useGuidedPath: () => mockHook }))

const baseHook = () => ({
  path,
  stepIndex: 0,
  stepCount: path.steps.length,
  answer: '',
  followUp: null,
  isFirst: true,
  isLast: false,
  deepening: false,
  submitting: false,
  setAnswer: jest.fn(),
  next: jest.fn(),
  back: jest.fn(),
  deepen: jest.fn(),
  finish: jest.fn().mockResolvedValue({ tier: 0, confidence: 0, keywordMatch: false }),
})

describe('PathRunnerScreen', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockBack.mockReset()
    mockHook = baseHook()
  })

  it('shows a not-found state for an unknown path', () => {
    mockHook = { ...baseHook(), path: undefined }
    render(<PathRunnerScreen />)
    expect(screen.getByText('Reflection not found')).toBeTruthy()
  })

  it('renders the current step prompt and a Next button mid-path', () => {
    render(<PathRunnerScreen />)
    expect(screen.getByText(path.steps[0].prompt)).toBeTruthy()
    expect(screen.getByTestId('path-next')).toBeTruthy()
  })

  it('shows the follow-up question once the model returns one', () => {
    mockHook = { ...baseHook(), answer: 'a lot', followUp: 'What feels heaviest?' }
    render(<PathRunnerScreen />)
    expect(screen.getByTestId('path-followup')).toBeTruthy()
    expect(screen.getByText('What feels heaviest?')).toBeTruthy()
  })

  it('finishing with no crisis shows the completion screen', async () => {
    mockHook = { ...baseHook(), stepIndex: path.steps.length - 1, isFirst: false, isLast: true }
    render(<PathRunnerScreen />)
    fireEvent.press(screen.getByTestId('path-finish'))
    await waitFor(() => expect(screen.getByText('Nicely done')).toBeTruthy())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('finishing with a confident crisis signal routes to /crisis', async () => {
    mockHook = {
      ...baseHook(),
      stepIndex: path.steps.length - 1,
      isFirst: false,
      isLast: true,
      finish: jest.fn().mockResolvedValue({ tier: 3, confidence: 0.9, keywordMatch: true }),
    }
    render(<PathRunnerScreen />)
    fireEvent.press(screen.getByTestId('path-finish'))
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/crisis',
        params: { tier: '3', conf: '0.9' },
      })
    )
  })
})
