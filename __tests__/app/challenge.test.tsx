import { act, fireEvent, render, screen } from '@testing-library/react-native'

import ChallengeScreen from '@/app/challenge'
import { type Challenge } from '@/services/storage/challenges'

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))

const mockCreate = jest.fn()
const mockCheckIn = jest.fn()
const mockRemove = jest.fn()
const mockUse = jest.fn()
jest.mock('@/hooks/useChallenge', () => ({ useChallenge: () => mockUse() }))

const mockSetCover = jest.fn()
jest.mock('@/services/challenges/cover', () => ({ setCoverAffirmation: (t: string) => mockSetCover(t) }))

const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  id: 'c1',
  title: 'Work out every day',
  details: '20 minutes of movement',
  target_days: 30,
  current_streak: 4,
  last_checkin_date: '2026-06-12',
  status: 'active',
  affirmation: '',
  created_at: 0,
  updated_at: 0,
  completed_at: null,
  ...over,
})

const baseHook = (over = {}) => ({
  challenge: null,
  rewards: [],
  loading: false,
  busy: false,
  streak: 0,
  doneToday: false,
  create: mockCreate,
  checkIn: mockCheckIn,
  remove: mockRemove,
  refresh: jest.fn(),
  ...over,
})

describe('ChallengeScreen', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockCreate.mockReset()
    mockCheckIn.mockReset()
    mockRemove.mockReset()
    mockSetCover.mockReset().mockResolvedValue({ success: true })
    mockUse.mockReturnValue(baseHook())
  })

  it('creates a challenge from the form', () => {
    render(<ChallengeScreen />)
    fireEvent.changeText(screen.getByTestId('challenge-title-input'), 'Read daily')
    fireEvent.changeText(screen.getByTestId('challenge-details-input'), '10 pages')
    fireEvent.press(screen.getByTestId('challenge-start'))
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Read daily', details: '10 pages' })
  })

  it('does not create with an empty title', () => {
    render(<ChallengeScreen />)
    fireEvent.press(screen.getByTestId('challenge-start'))
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('shows the active challenge with progress and a check-in button', () => {
    mockUse.mockReturnValue(baseHook({ challenge: challenge(), streak: 4 }))
    render(<ChallengeScreen />)
    expect(screen.getByText('Work out every day')).toBeTruthy()
    expect(screen.getByText('Day 4 of 30')).toBeTruthy()
    fireEvent.press(screen.getByTestId('challenge-checkin'))
    expect(mockCheckIn).toHaveBeenCalled()
  })

  it('shows "Crafting your reward…" on the final check-in while busy', () => {
    // streak at target-1, not done today, busy → the completing tap is generating.
    mockUse.mockReturnValue(
      baseHook({ challenge: challenge({ current_streak: 29 }), streak: 29, busy: true })
    )
    render(<ChallengeScreen />)
    expect(screen.getByTestId('challenge-crafting')).toBeTruthy()
  })

  it('does not show the crafting message on a non-final check-in', () => {
    mockUse.mockReturnValue(
      baseHook({ challenge: challenge(), streak: 4, busy: true })
    )
    render(<ChallengeScreen />)
    expect(screen.queryByTestId('challenge-crafting')).toBeNull()
  })

  it('disables the button and hides check-in once done today', () => {
    mockUse.mockReturnValue(baseHook({ challenge: challenge(), streak: 4, doneToday: true }))
    render(<ChallengeScreen />)
    expect(screen.getByTestId('challenge-done-today')).toBeTruthy()
    expect(screen.queryByTestId('challenge-checkin')).toBeNull()
  })

  it('celebrates completion and lets the user set the cover affirmation', async () => {
    mockCheckIn.mockResolvedValue({
      challenge: challenge({ status: 'completed', affirmation: 'I finish what I start.' }),
      decision: { outcome: 'continued', streak: 30, justCompleted: true },
    })
    mockUse.mockReturnValue(baseHook({ challenge: challenge({ current_streak: 29 }), streak: 29 }))
    render(<ChallengeScreen />)

    await act(async () => {
      fireEvent.press(screen.getByTestId('challenge-checkin'))
    })
    expect(await screen.findByTestId('challenge-complete')).toBeTruthy()
    expect(screen.getByText('I finish what I start.')).toBeTruthy()

    await act(async () => {
      fireEvent.press(screen.getByTestId('challenge-set-cover'))
    })
    expect(mockSetCover).toHaveBeenCalledWith('I finish what I start.')
  })

  it('lists earned rewards with their affirmations', () => {
    mockUse.mockReturnValue(
      baseHook({
        rewards: [
          challenge({ id: 'r1', status: 'completed', affirmation: 'I show up.', completed_at: 1_700_000_000_000 }),
        ],
      })
    )
    render(<ChallengeScreen />)
    expect(screen.getByTestId('challenge-rewards')).toBeTruthy()
    expect(screen.getByText('“I show up.”')).toBeTruthy()
  })

  it('hides the rewards section during the completion celebration', async () => {
    mockCheckIn.mockResolvedValue({
      challenge: challenge({ status: 'completed', affirmation: 'Done.' }),
      decision: { outcome: 'continued', streak: 30, justCompleted: true },
    })
    mockUse.mockReturnValue(
      baseHook({
        challenge: challenge({ current_streak: 29 }),
        streak: 29,
        rewards: [challenge({ id: 'r1', status: 'completed', affirmation: 'Old.' })],
      })
    )
    render(<ChallengeScreen />)
    await act(async () => {
      fireEvent.press(screen.getByTestId('challenge-checkin'))
    })
    expect(await screen.findByTestId('challenge-complete')).toBeTruthy()
    expect(screen.queryByTestId('challenge-rewards')).toBeNull()
  })

  it('gives up the active challenge', () => {
    mockUse.mockReturnValue(baseHook({ challenge: challenge() }))
    render(<ChallengeScreen />)
    fireEvent.press(screen.getByTestId('challenge-give-up'))
    expect(mockRemove).toHaveBeenCalled()
  })

  it('navigates back', () => {
    render(<ChallengeScreen />)
    fireEvent.press(screen.getByTestId('challenge-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})
