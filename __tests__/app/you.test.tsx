import { render, screen, fireEvent } from '@testing-library/react-native'

import YouScreen from '@/app/(tabs)/you'
const mockPush = jest.fn()
const mockUseWikiPages = jest.fn()
const mockUseTrendingPages = jest.fn()
const mockUseGraph = jest.fn()
const mockUseNodeContext = jest.fn()
const mockUseNodeDismissals = jest.fn()
const mockUseDigest = jest.fn()
const mockUseEntries = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))

jest.mock('@/hooks/useWiki', () => ({
  useWikiPages: (...a: unknown[]) => mockUseWikiPages(...a),
  useDismissedPages: () => ({ pages: [], loading: false, refresh: jest.fn() }),
  useTrendingPages: () => mockUseTrendingPages(),
}))

jest.mock('@/hooks/useGraph', () => ({
  useGraph: (...a: unknown[]) => mockUseGraph(...a),
  useNodeContext: (...a: unknown[]) => mockUseNodeContext(...a),
  useNodeDismissals: () => mockUseNodeDismissals(),
}))

jest.mock('@/components/graph/Graph3D', () => {
  const React = require('react')
  const { Text } = require('react-native')
  return { Graph3D: () => React.createElement(Text, null, 'Graph3D-mock') }
})

jest.mock('@/hooks/useDigest', () => ({ useDigest: () => mockUseDigest() }))
jest.mock('@/hooks/useEntries', () => ({ useEntries: () => mockUseEntries() }))
jest.mock('@/services/storage/wiki', () => ({ listPages: jest.fn() }))
jest.mock('@/services/storage/graph', () => ({ dismissNode: jest.fn() }))
jest.mock('@/store/wiki.store', () => ({
  useWikiStore: () => ({ pending: 0 }),
}))
jest.mock('@/hooks/useStreakFreezes', () => ({
  useStreakFreezes: () => ({ frozenDays: new Set<number>() }),
}))
jest.mock('@/hooks/useMergeSuggestions', () => ({
  useMergeSuggestions: () => ({ suggestions: [], dismiss: jest.fn() }),
}))
jest.mock('@/services/onboarding/first-run', () => ({
  getHintSeen: jest.fn().mockResolvedValue(true),
  markHintSeen: jest.fn().mockResolvedValue(undefined),
}))

describe('YouScreen', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockUseWikiPages.mockReturnValue({ pages: [], loading: false })
    mockUseTrendingPages.mockReturnValue([])
    mockUseGraph.mockReturnValue({ nodes: [], edges: [], refresh: jest.fn() })
    mockUseNodeContext.mockReturnValue({ context: null })
    mockUseNodeDismissals.mockReturnValue({ dismissals: [], refresh: jest.fn() })
    mockUseDigest.mockReturnValue({ digest: null, loading: true, synthesizing: false })
    mockUseEntries.mockReturnValue({ entries: [] })
  })

  it('renders with the Pages segment selected by default', () => {
    render(<YouScreen />)
    expect(screen.getByTestId('you-tab-pages').props.accessibilityRole).toBe('tab')
    expect(screen.getByTestId('you-tab-pages').props.accessibilityState.selected).toBe(true)
    expect(screen.getByTestId('you-tab-patterns').props.accessibilityState.selected).toBe(false)
    expect(screen.getByTestId('you-tab-map').props.accessibilityState.selected).toBe(false)
    expect(screen.getByText('Browse the insight pages built from your entries.')).toBeTruthy()
    expect(screen.getByText('No pages yet')).toBeTruthy()
  })

  it('updates the tab description for each You segment', () => {
    render(<YouScreen />)

    fireEvent.press(screen.getByTestId('you-tab-patterns'))
    expect(screen.getByText('Notice trends in your mood, thoughts, and rhythms.')).toBeTruthy()

    fireEvent.press(screen.getByTestId('you-tab-map'))
    expect(screen.getByText('See how your emotions, themes, and patterns connect.')).toBeTruthy()
  })

  it('switches to Patterns segment and shows digest-trends content', () => {
    mockUseDigest.mockReturnValue({ digest: null, loading: false, synthesizing: false })
    mockUseEntries.mockReturnValue({ entries: [] })
    render(<YouScreen />)
    fireEvent.press(screen.getByTestId('you-tab-patterns'))
    expect(screen.getByTestId('you-tab-patterns').props.accessibilityState.selected).toBe(true)
    expect(screen.getByTestId('you-tab-pages').props.accessibilityState.selected).toBe(false)
    expect(screen.getByText('Trends')).toBeTruthy()
  })

  it('switches to Map segment and shows empty state when no nodes', () => {
    render(<YouScreen />)
    fireEvent.press(screen.getByTestId('you-tab-map'))
    expect(screen.getByTestId('you-tab-map').props.accessibilityState.selected).toBe(true)
    expect(screen.getByText(/No connections yet/)).toBeTruthy()
  })

  it('exposes the segmented control as a tab list', () => {
    render(<YouScreen />)
    expect(screen.getByTestId('you-tabs').props.accessibilityRole).toBe('tablist')
  })

  it('renders the graph in Map segment when nodes exist', () => {
    mockUseGraph.mockReturnValue({
      nodes: [{ id: 'n1', label: 'Anxiety', type: 'emotion', frequency: 3 }],
      edges: [],
      refresh: jest.fn(),
    })
    render(<YouScreen />)
    fireEvent.press(screen.getByText('Map'))
    expect(screen.getByText('Graph3D-mock')).toBeTruthy()
  })

  it('opens and closes the graph full-screen mode with filter chips', () => {
    mockUseGraph.mockReturnValue({
      nodes: [{ id: 'n1', label: 'Anxiety', type: 'emotion', frequency: 3 }],
      edges: [],
      refresh: jest.fn(),
    })
    render(<YouScreen />)
    fireEvent.press(screen.getByTestId('you-tab-map'))

    expect(screen.getByTestId('graph-zoom-in')).toBeTruthy()
    expect(screen.getByTestId('graph-zoom-out')).toBeTruthy()
    fireEvent.press(screen.getByTestId('graph-fullscreen-open'))
    expect(screen.getByTestId('graph-fullscreen-modal')).toBeTruthy()
    expect(screen.getAllByText('all')).toHaveLength(2)
    expect(screen.getAllByText('Graph3D-mock')).toHaveLength(2)

    fireEvent.press(screen.getByTestId('graph-fullscreen-close'))
    expect(screen.queryByTestId('graph-fullscreen-modal')).toBeNull()
  })

  it('does not show full-screen mode when the Map is empty', () => {
    render(<YouScreen />)
    fireEvent.press(screen.getByTestId('you-tab-map'))
    expect(screen.queryByTestId('graph-fullscreen-open')).toBeNull()
  })

  it('renders category rows in Pages segment when pages exist', () => {
    mockUseWikiPages.mockReturnValue({
      pages: [
        { id: 'a', title: 'Anxiety', category: 'emotion', dismissed_at: null },
        { id: 'w', title: 'Work', category: 'theme', dismissed_at: null },
      ],
      loading: false,
    })
    render(<YouScreen />)
    expect(screen.getByText('Emotions')).toBeTruthy()
    expect(screen.getByText('Themes')).toBeTruthy()
  })
})
