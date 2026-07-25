// TDD tests for F-04b: WikiConnections is presentation-only, hook owns state.
// These verify explicit states: loading, error, loaded-with-connections,
// loaded-no-connections. The hook (useWikiConnections) is mocked so the
// component test focuses on rendering and chip-deep-link behavior.

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { WikiConnections } from '@/components/wiki/WikiConnections'
import { useWikiConnections, type WikiConnectionsData } from '@/hooks/useWikiConnections'

jest.mock('expo-router', () => {
  const router = { push: jest.fn() }
  return { useRouter: () => router, router }
})

jest.mock('@/hooks/useWikiConnections', () => ({
  useWikiConnections: jest.fn(),
}))
const mockedUse = useWikiConnections as jest.MockedFunction<typeof useWikiConnections>

const baseData: WikiConnectionsData = {
  status: 'loading',
  labels: [],
  pages: [],
  error: null,
}

afterEach(() => {
  mockedUse.mockReset()
})

describe('WikiConnections — loading state', () => {
  it('renders nothing while loading', () => {
    mockedUse.mockReturnValue({ ...baseData, status: 'loading' })
    render(<WikiConnections title="Anxiety" />)
    expect(screen.queryByTestId('wiki-connections')).toBeNull()
    expect(screen.queryByTestId('wiki-connections-error')).toBeNull()
  })
})

describe('WikiConnections — loaded with connections', () => {
  it('renders a chip per top-N label and a wiki-page link for matching pages', () => {
    mockedUse.mockReturnValue({
      status: 'loaded',
      labels: ['Work', 'Sleep'],
      pages: [
        { id: 'p-work', title: 'Work' } as any,
        { id: 'p-sleep', title: 'Sleep' } as any,
      ],
      error: null,
    })
    render(<WikiConnections title="Anxiety" />)
    expect(screen.getByTestId('wiki-connections')).toBeTruthy()
    expect(screen.getByTestId('wiki-connection-Work')).toBeTruthy()
    expect(screen.getByTestId('wiki-connection-Sleep')).toBeTruthy()
  })

  it('resolves case-insensitively — chip on page "work" matches label "Work"', () => {
    mockedUse.mockReturnValue({
      status: 'loaded',
      labels: ['Work'],
      pages: [{ id: 'p-work', title: 'work' } as any],
      error: null,
    })
    render(<WikiConnections title="Anxiety" />)
    const chip = screen.getByTestId('wiki-connection-Work')
    fireEvent.press(chip)
    // Router push receives the matching page id.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router')
    expect(router.push).toHaveBeenCalledWith('/wiki/p-work')
  })

  it('routes to focused graph node when no matching wiki page exists', () => {
    mockedUse.mockReturnValue({
      status: 'loaded',
      labels: ['Sleep'],
      pages: [], // no wiki page for "Sleep"
      error: null,
    })
    render(<WikiConnections title="Anxiety" />)
    fireEvent.press(screen.getByTestId('wiki-connection-Sleep'))
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router')
    expect(router.push).toHaveBeenCalledWith({ pathname: '/graph', params: { focus: 'Sleep' } })
  })
})

describe('WikiConnections — loaded with no connections', () => {
  it('renders nothing when labels is empty (no error, no chips)', () => {
    mockedUse.mockReturnValue({ ...baseData, status: 'loaded', labels: [] })
    render(<WikiConnections title="Anxiety" />)
    expect(screen.queryByTestId('wiki-connections')).toBeNull()
    expect(screen.queryByTestId('wiki-connections-error')).toBeNull()
  })
})

describe('WikiConnections — error state', () => {
  it('renders an unobtrusive error row when storage reads fail', async () => {
    mockedUse.mockReturnValue({
      status: 'error',
      labels: [],
      pages: [],
      error: 'Failed to read graph: nodes, edges',
    })
    render(<WikiConnections title="Anxiety" />)
    await waitFor(() => screen.getByTestId('wiki-connections-error'))
    // No chip block (we do NOT masquerade as empty success).
    expect(screen.queryByTestId('wiki-connections')).toBeNull()
  })

  it('does not log labels in the error path', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockedUse.mockReturnValue({
      status: 'error',
      labels: [],
      pages: [],
      error: 'Failed to read graph: nodes',
    })
    render(<WikiConnections title="Anxiety" />)
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
