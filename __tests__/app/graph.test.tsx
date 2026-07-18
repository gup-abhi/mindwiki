import { Alert } from 'react-native'
import { render, screen, fireEvent } from '@testing-library/react-native'

import YouScreen from '@/app/(tabs)/you'
import { dismissNode } from '@/services/storage/graph'

const mockUseGraph = jest.fn()
const mockRefresh = jest.fn()
const mockUseNodeContext = jest.fn()
const mockUseNodeDismissals = jest.fn(() => ({
  dismissals: [] as Array<{ id: string; type: string; label: string; dismissed_at: number; updated_at: number }>,
  refresh: jest.fn(),
}))
jest.mock('@/hooks/useGraph', () => ({
  useGraph: (...a: unknown[]) => mockUseGraph(...a),
  useNodeContext: (...a: unknown[]) => mockUseNodeContext(...a),
  useNodeDismissals: () => mockUseNodeDismissals(),
}))

jest.mock('@/services/storage/graph', () => ({ dismissNode: jest.fn() }))
const mockDismissNode = dismissNode as jest.Mock

const mockPush = jest.fn()
let mockParams: Record<string, string> = {}
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))

// The 3D graph runs in a WebView, which can't render under the test runner. Stub
// it with a pressable per node so we can still exercise the screen's filtering
// and node-selection wiring.
jest.mock('@/components/graph/Graph3D', () => {
  const React = require('react')
  const { Pressable, Text } = require('react-native')
  return {
    Graph3D: ({ nodes, onSelect }: { nodes: { id: string; label: string }[]; onSelect: (n: unknown) => void }) =>
      nodes.map((n) =>
        React.createElement(
          Pressable,
          { key: n.id, testID: 'graph-node', onPress: () => onSelect(n) },
          React.createElement(Text, null, n.label)
        )
      ),
  }
})

// Mocks for YouScreen segments other than Map
jest.mock('@/hooks/useWiki', () => ({
  useWikiPages: () => ({ pages: [], loading: false }),
  useDismissedPages: () => ({ pages: [], loading: false, refresh: jest.fn() }),
  useTrendingPages: () => [],
}))
jest.mock('@/hooks/useEntries', () => ({ useEntries: () => ({ entries: [] }) }))
jest.mock('@/hooks/useStreakFreezes', () => ({
  useStreakFreezes: () => ({ frozenDays: new Set<number>() }),
}))
jest.mock('@/hooks/useMergeSuggestions', () => ({
  useMergeSuggestions: () => ({ suggestions: [], dismiss: jest.fn() }),
}))
jest.mock('@/hooks/useDigest', () => ({ useDigest: () => ({ digest: null, loading: true, synthesizing: false }) }))
jest.mock('@/store/wiki.store', () => ({ useWikiStore: () => ({ pending: 0 }) }))
jest.mock('@/services/onboarding/first-run', () => ({
  getHintSeen: jest.fn().mockResolvedValue(true),
  markHintSeen: jest.fn().mockResolvedValue(undefined),
}))

const nodes = [
  { id: 'n1', type: 'emotion', label: 'Anxiety', frequency: 3, created_at: 0, updated_at: 0 },
  { id: 'n2', type: 'situation', label: 'Work', frequency: 1, created_at: 0, updated_at: 0 },
]
const edges = [{ id: 'e1', source_id: 'n1', target_id: 'n2', weight: 2, created_at: 0, updated_at: 0 }]

function renderMap() {
  render(<YouScreen />)
  fireEvent.press(screen.getByTestId('you-tab-map'))
}

describe('GraphScreen (inside You tab > Map segment)', () => {
  beforeEach(() => {
    mockUseGraph.mockReturnValue({ nodes, edges, refresh: mockRefresh })
    mockUseNodeContext.mockReturnValue({ context: null, loading: false })
    mockUseNodeDismissals.mockReturnValue({ dismissals: [], refresh: jest.fn() })
    mockPush.mockReset()
    mockRefresh.mockReset()
    mockDismissNode.mockReset().mockResolvedValue({ success: true })
    mockParams = {}
  })

  it('renders filter pills and a node per visible node', () => {
    renderMap()
    expect(screen.getByText('all')).toBeTruthy()
    expect(screen.getByText('emotion')).toBeTruthy()
    expect(screen.getAllByTestId('graph-node')).toHaveLength(2)
  })

  it('focuses a node from a deep-link focus param (case-insensitive)', () => {
    mockParams = { focus: 'work' }
    renderMap()
    expect(screen.getByText('situation · appeared 1 time')).toBeTruthy()
  })

  it('ignores a focus param that matches no node', () => {
    mockParams = { focus: 'nonexistent' }
    renderMap()
    expect(screen.queryByText(/appeared/)).toBeNull()
  })

  it('shows a node detail card on tap', () => {
    renderMap()
    fireEvent.press(screen.getAllByTestId('graph-node')[0])
    expect(screen.getByText('emotion · appeared 3 times')).toBeTruthy()
  })

  it('lists the pages and entries behind a tapped node and navigates to them', () => {
    mockUseNodeContext.mockReturnValue({
      context: {
        pages: [{ id: 'p1', title: 'Anxiety', category: 'Emotions' }],
        entries: [{ id: 'en1', situation: 'Big presentation', created_at: 0 }],
      },
      loading: false,
    })
    renderMap()
    fireEvent.press(screen.getAllByTestId('graph-node')[0])

    fireEvent.press(screen.getByTestId('graph-node-page'))
    expect(mockPush).toHaveBeenCalledWith('/wiki/p1')

    fireEvent.press(screen.getByTestId('graph-node-entry'))
    expect(mockPush).toHaveBeenCalledWith('/entries/en1')
  })

  it('shows an empty state with no nodes', () => {
    mockUseGraph.mockReturnValue({ nodes: [], edges: [], refresh: mockRefresh })
    renderMap()
    expect(screen.getByText(/No connections yet/)).toBeTruthy()
  })

  it('drops a node from the detail card after confirming', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
      btns?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    renderMap()
    fireEvent.press(screen.getAllByTestId('graph-node')[0])
    fireEvent.press(screen.getByTestId('graph-drop'))
    expect(spy).toHaveBeenCalled()
    expect(mockDismissNode).toHaveBeenCalledWith('emotion', 'Anxiety')
    spy.mockRestore()
  })

  it('shows the Hidden link and opens it when nodes were dropped', () => {
    mockUseNodeDismissals.mockReturnValue({
      dismissals: [{ id: 'emotion:anxiety', type: 'emotion', label: 'Anxiety', dismissed_at: 1, updated_at: 1 }],
      refresh: jest.fn(),
    })
    renderMap()
    fireEvent.press(screen.getByTestId('graph-hidden-link'))
    expect(mockPush).toHaveBeenCalledWith('/graph/hidden')
  })

  it('hides the Hidden link when nothing is dropped', () => {
    renderMap()
    expect(screen.queryByTestId('graph-hidden-link')).toBeNull()
  })
})
