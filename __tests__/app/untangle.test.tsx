import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import React from 'react'

// Mock theme hooks so the screen renders without a ThemeProvider.
jest.mock('@/theme', () => {
  const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48 }
  const radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 }
  const colors = { accent: '#007AFF', cardBackground: '#F2F2F7', textMuted: '#8E8E93', textSecondary: '#3C3C43' }
  return {
    useTheme: () => ({ spacing, radii, colors, typography: {} }),
    useThemedStyles: () => ({}),
  }
})

import UntangleScreen from '@/app/untangle'

const mockBack = jest.fn()
const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}))

// Mock the hook with controllable state.
const mockSubmit = jest.fn()
const mockNext = jest.fn()
const mockPrevious = jest.fn()
const mockSetSelected = jest.fn()
const mockSetObs = jest.fn()
const mockGenerate = jest.fn().mockResolvedValue(undefined)
const mockFinish = jest.fn()
const mockCancel = jest.fn()

let mockState: Record<string, any> = {
  step: 'idle',
  stage: 0,
  thought: '',
  patterns: [],
  selectedPatterns: [],
  observations: [],
  candidates: null,
  matchedBelief: null,
  error: false,
}

jest.mock('@/hooks/useUntangleThought', () => ({
  useUntangleThought: () => ({
    ...mockState,
    submitThought: mockSubmit,
    next: mockNext,
    previous: mockPrevious,
    setSelectedPatterns: mockSetSelected,
    setObservations: mockSetObs,
    generateCandidates: mockGenerate,
    finishReframe: mockFinish,
    cancel: mockCancel,
  }),
}))

describe('UntangleScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockState = {
      step: 'idle',
      stage: 0,
      thought: '',
      patterns: [],
      selectedPatterns: [],
      observations: [],
      candidates: null,
      matchedBelief: null,
      error: false,
    }
    mockFinish.mockResolvedValue(false)
  })

  it('shows Catch progress starting at 20%, not zero', () => {
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-progress')).toBeTruthy()
    expect(screen.getByTestId('untangle-progress').children[0].props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '20%' })])
    )
  })

  it('shows the Catch step with an editable text field when idle', () => {
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-catch-input')).toBeTruthy()
  })

  it('shows full progress at Reframe', () => {
    mockState = {
      ...mockState,
      step: 'ready',
      stage: 4,
      candidates: { factual: 'a', gentle: 'b', action: 'c' },
    }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-progress').children[0].props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })])
    )
  })

  it('pressing start submits the thought', () => {
    render(<UntangleScreen />)
    fireEvent.changeText(screen.getByTestId('untangle-catch-input'), 'I feel anxious')
    fireEvent.press(screen.getByTestId('untangle-start-button'))
    expect(mockSubmit).toHaveBeenCalledWith('I feel anxious')
  })

  it('shows crisis routing with a direct 988 action', () => {
    mockState = { ...mockState, step: 'crisis' }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-crisis-view')).toBeTruthy()
    expect(screen.getByTestId('untangle-crisis-call')).toBeTruthy()
  })

  it('exposes accessible labels for back and source actions', () => {
    mockState = {
      ...mockState,
      step: 'ready',
      stage: 3,
      observations: [{ pageId: 'p1', title: 'Work', excerpt: 'A source excerpt.' }],
    }
    render(<UntangleScreen />)
    expect(screen.getByLabelText('Back to Reflect')).toBeTruthy()
    expect(screen.getByLabelText('Open wiki page Work')).toBeTruthy()
  })

  it('shows loading state', () => {
    mockState = { ...mockState, step: 'loading' }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-loading')).toBeTruthy()
  })

  it('shows error state with retry button', () => {
    mockState = { ...mockState, step: 'error', thought: 'saved thought', error: true }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-retry-button')).toBeTruthy()
  })

  it('shows Unhook step with distancing sentence', () => {
    mockState = { ...mockState, step: 'ready', stage: 1, thought: 'I am going to fail' }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-unhook-text')).toBeTruthy()
  })

  it('shows Spot step with suggested pattern chips', () => {
    mockState = {
      ...mockState, step: 'ready', stage: 2, thought: 'I am useless',
      patterns: ['Labeling', 'Catastrophizing'],
      selectedPatterns: ['Labeling', 'Catastrophizing'],
    }
    render(<UntangleScreen />)
    expect(screen.getByText('Labeling')).toBeTruthy()
    expect(screen.getByText('Catastrophizing')).toBeTruthy()
  })

  it('handles None of these and I am not sure as selectable choices', () => {
    mockState = { ...mockState, step: 'ready', stage: 2, patterns: ['Labeling'] }
    render(<UntangleScreen />)
    fireEvent.press(screen.getByTestId('untangle-none-button'))
    expect(mockSetSelected).toHaveBeenCalledWith([])
    fireEvent.press(screen.getByTestId('untangle-unsure-button'))
    expect(mockSetSelected).toHaveBeenCalledWith([])
  })

  it('shows Check step with observations', () => {
    mockState = {
      ...mockState, step: 'ready', stage: 3,
      observations: [
        { pageId: 'p1', title: 'Work', excerpt: 'You feel anxious before meetings.' },
      ],
    }
    render(<UntangleScreen />)
    expect(screen.getByText(/You feel anxious before meetings/i)).toBeTruthy()
  })

  it('shows Check step with empty state when no observations', () => {
    mockState = { ...mockState, step: 'ready', stage: 3, observations: [] }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-no-observations')).toBeTruthy()
  })

  it('advances from Check and requests candidate generation', () => {
    mockState = {
      ...mockState,
      step: 'ready',
      stage: 3,
      observations: [],
      candidateLoading: false,
    }
    render(<UntangleScreen />)
    fireEvent.press(screen.getByTestId('untangle-next-button'))
    expect(mockNext).toHaveBeenCalledTimes(1)
    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('shows candidate-generation failure with a retry action', () => {
    mockState = {
      ...mockState,
      step: 'ready',
      stage: 4,
      error: true,
      candidateLoading: false,
      candidates: null,
    }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-candidate-error')).toBeTruthy()
    fireEvent.press(screen.getByTestId('untangle-candidate-retry'))
    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('returns directly to Reflect after finish succeeds', async () => {
    mockState = {
      ...mockState,
      step: 'ready',
      stage: 4,
      matchedBelief: 'I am not good enough',
      candidates: { factual: 'I can learn', gentle: 'I am okay', action: 'I can try' },
    }
    mockFinish.mockResolvedValue(true)
    render(<UntangleScreen />)
    fireEvent.press(screen.getByTestId('untangle-finish-button'))
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('untangle-done-button')).toBeNull()
  })

  it('keeps the reframe visible and reports a save failure', async () => {
    mockState = {
      ...mockState,
      step: 'ready',
      stage: 4,
      matchedBelief: 'I am not good enough',
      candidates: { factual: 'I can learn', gentle: 'I am okay', action: 'I can try' },
    }
    mockFinish.mockResolvedValue(false)
    render(<UntangleScreen />)
    fireEvent.press(screen.getByTestId('untangle-finish-button'))
    await waitFor(() => expect(screen.getByTestId('untangle-save-error')).toBeTruthy())
    expect(screen.queryByTestId('untangle-saved-confirmation')).toBeNull()
  })

  it('shows Reframe step with three candidates when available', () => {
    mockState = {
      ...mockState, step: 'ready', stage: 4,
      candidates: {
        factual: 'I do not know what others think.',
        gentle: 'It is okay to feel nervous.',
        action: 'I can prepare one thing.',
      },
    }
    render(<UntangleScreen />)
    expect(screen.getByText(/I do not know what others think/i)).toBeTruthy()
    expect(screen.getByText(/It is okay to feel nervous/i)).toBeTruthy()
    expect(screen.getByText(/I can prepare one thing/i)).toBeTruthy()
  })

  it('shows a finish button on reframe stage', () => {
    mockState = { ...mockState, step: 'ready', stage: 4, candidates: { factual: 'a', gentle: 'b', action: 'c' } }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-finish-button')).toBeTruthy()
  })

  it('goes back one Untangle step while the exercise is active', () => {
    mockState = { ...mockState, step: 'ready', stage: 3, thought: 'x' }
    render(<UntangleScreen />)
    fireEvent.press(screen.getByTestId('untangle-cancel-button'))
    expect(mockPrevious).toHaveBeenCalledTimes(1)
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('exits to Reflect from the initial Catch step', () => {
    render(<UntangleScreen />)
    fireEvent.press(screen.getByTestId('untangle-cancel-button'))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('has a cancel button', () => {
    mockState = { ...mockState, step: 'ready', stage: 1, thought: 'x' }
    render(<UntangleScreen />)
    expect(screen.getByTestId('untangle-cancel-button')).toBeTruthy()
  })
})
