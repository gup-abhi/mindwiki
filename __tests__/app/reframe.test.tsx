import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'

import ReframeScreen from '@/app/reframe'
import { ok } from '@/types/result'

const mockBack = jest.fn()
let mockParams: Record<string, string> = { pageId: 'belief-page-1' }
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}))

const mockSave = jest.fn()
const mockSuggest = jest.fn()
jest.mock('@/hooks/useReframes', () => ({
  useReframes: () => ({ reframes: [], refresh: jest.fn(), save: mockSave, suggest: mockSuggest }),
}))

jest.mock('@/hooks/useWiki', () => ({
  useWikiPage: (pageId?: string) => ({
    page: pageId ? { id: 'belief-page-1', title: 'I am not good enough', category: 'belief' } : null,
    loading: false,
  }),
}))

describe('ReframeScreen', () => {
  beforeEach(() => {
    mockParams = { pageId: 'belief-page-1' }
    mockBack.mockReset()
    mockSave.mockReset().mockResolvedValue(ok({ id: 'r1' }))
    mockSuggest.mockReset().mockResolvedValue(ok('I can be nervous and still capable.'))
  })

  it('shows the belief being challenged', () => {
    render(<ReframeScreen />)
    expect(screen.getByText('“I am not good enough”')).toBeTruthy()
  })

  it('fills the balanced thought from an AI suggestion', async () => {
    render(<ReframeScreen />)
    fireEvent.changeText(screen.getByTestId('reframe-evidence-for'), 'I froze in the meeting')
    fireEvent.press(screen.getByTestId('reframe-suggest'))

    await waitFor(() =>
      expect(mockSuggest).toHaveBeenCalledWith('I froze in the meeting', '')
    )
    await waitFor(() =>
      expect(screen.getByTestId('reframe-balanced').props.value).toBe(
        'I can be nervous and still capable.'
      )
    )
  })

  it('saves the reframe and navigates back', async () => {
    render(<ReframeScreen />)
    fireEvent.changeText(screen.getByTestId('reframe-evidence-for'), 'froze')
    fireEvent.changeText(screen.getByTestId('reframe-evidence-against'), 'shipped it')
    fireEvent.changeText(screen.getByTestId('reframe-balanced'), 'I can be nervous and still capable.')
    fireEvent.press(screen.getByTestId('reframe-save'))

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        evidence_for: 'froze',
        evidence_against: 'shipped it',
        balanced_thought: 'I can be nervous and still capable.',
      })
    )
    await waitFor(() => expect(mockBack).toHaveBeenCalled())
  })

  it('does not save with an empty balanced thought', () => {
    render(<ReframeScreen />)
    fireEvent.press(screen.getByTestId('reframe-save')) // disabled — no-op
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows a fallback when no page id was passed', () => {
    mockParams = {}
    render(<ReframeScreen />)
    expect(screen.getByText('No belief to reframe.')).toBeTruthy()
  })
})
