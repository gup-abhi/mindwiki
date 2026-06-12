import { render, screen, fireEvent } from '@testing-library/react-native'

import GraphScreen from '@/app/(tabs)/graph'

const mockUseGraph = jest.fn()
jest.mock('@/hooks/useGraph', () => ({ useGraph: (...a: unknown[]) => mockUseGraph(...a) }))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

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

const nodes = [
  { id: 'n1', type: 'emotion', label: 'Anxiety', frequency: 3, created_at: 0, updated_at: 0 },
  { id: 'n2', type: 'situation', label: 'Work', frequency: 1, created_at: 0, updated_at: 0 },
]
const edges = [{ id: 'e1', source_id: 'n1', target_id: 'n2', weight: 2, created_at: 0, updated_at: 0 }]

describe('GraphScreen', () => {
  beforeEach(() => mockUseGraph.mockReturnValue({ nodes, edges, layout: new Map() }))

  it('renders filter pills and a node per visible node', () => {
    render(<GraphScreen />)
    expect(screen.getByText('all')).toBeTruthy()
    expect(screen.getByText('emotion')).toBeTruthy()
    expect(screen.getAllByTestId('graph-node')).toHaveLength(2)
  })

  it('shows a node detail card on tap', () => {
    render(<GraphScreen />)
    fireEvent.press(screen.getAllByTestId('graph-node')[0])
    expect(screen.getByText('emotion · appeared 3 times')).toBeTruthy()
  })

  it('shows an empty state with no nodes', () => {
    mockUseGraph.mockReturnValue({ nodes: [], edges: [], layout: new Map() })
    render(<GraphScreen />)
    expect(screen.getByText(/No graph yet/)).toBeTruthy()
  })
})
