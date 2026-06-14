import { render, screen, waitFor } from '@testing-library/react-native'

import { CoverScreen } from '@/components/CoverScreen'

const mockGet = jest.fn()
jest.mock('@/services/challenges/cover', () => ({ getCoverAffirmation: () => mockGet() }))

// NOTE: these run in order — the component keeps a module-level "shown this
// launch" flag, so the cases below also assert the once-per-launch behavior.
describe('CoverScreen', () => {
  it('renders nothing when no affirmation is set (flag stays unset)', async () => {
    mockGet.mockResolvedValue('')
    render(<CoverScreen />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(screen.queryByTestId('cover-affirmation')).toBeNull()
  })

  it('flashes the earned affirmation when one is set', async () => {
    mockGet.mockResolvedValue('I finish what I start.')
    render(<CoverScreen />)
    expect(await screen.findByTestId('cover-affirmation')).toBeTruthy()
    expect(screen.getByText('I finish what I start.')).toBeTruthy()
  })

  it('does not show again on a later mount in the same launch', () => {
    mockGet.mockClear().mockResolvedValue('Again')
    render(<CoverScreen />)
    // The once-per-launch flag short-circuits before any DB read.
    expect(mockGet).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cover-affirmation')).toBeNull()
  })
})
