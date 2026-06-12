import { render, screen, act } from '@testing-library/react-native'

import { Graph3D, buildGraphHtml } from '@/components/graph/Graph3D'
import { type GraphNode, type GraphEdge, type NodeType } from '@/services/storage/graph'

// Capture the props the WebView is rendered with, and expose injectJavaScript so
// we can assert filter pushes. The real WebView can't run in the test runner.
let mockWebProps: Record<string, any> = {}
const mockInjectSpy = jest.fn()
jest.mock('react-native-webview', () => {
  const React = require('react')
  const { View } = require('react-native')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    mockWebProps = props
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInjectSpy }))
    return React.createElement(View, { testID: props.testID })
  })
  return { WebView }
})

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: jest.fn(async () => {}), localUri: 'file://lib.txt' }) },
}))
jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn(async () => 'LIBJS;') }))

const colors = {
  emotion: '#E08A8A',
  situation: '#88B', person: '#8B8', belief: '#BB8', behavior: '#8BB',
  distortion: '#B88', place: '#888', activity: '#999',
} as Record<NodeType, string>

const nodes: GraphNode[] = [
  { id: 'n1', type: 'emotion', label: 'Anxiety', frequency: 3, created_at: 0, updated_at: 0 },
  { id: 'n2', type: 'situation', label: 'Work', frequency: 1, created_at: 0, updated_at: 0 },
]
const edges: GraphEdge[] = [{ id: 'e1', source_id: 'n1', target_id: 'n2', weight: 2, created_at: 0, updated_at: 0 }]

describe('buildGraphHtml', () => {
  it('inlines the library, the data, orbit controls, and the filter hook', () => {
    const html = buildGraphHtml(
      'LIBCONTENT',
      { nodes: [{ id: 'n1', type: 'emotion', label: 'Anxiety', val: 3 }], links: [{ source: 'n1', target: 'n2', weight: 2 }] },
      colors,
      '#cccccc',
      '#445544',
      '#ffffff'
    )
    expect(html).toContain('LIBCONTENT')
    expect(html).toContain('ForceGraph3D')
    expect(html).toContain("controlType: 'orbit'")
    expect(html).toContain('Anxiety')
    expect(html).toContain('applyFilter')
    // always-on labels, themed with the supplied label color
    expect(html).toContain('buildLabels')
    expect(html).toContain('graph2ScreenCoords')
    expect(html).toContain('#445544')
    // labels get a readable background pill derived from the bg color
    expect(html).toContain('rgba(255, 255, 255, 0.82)')
    expect(html).toContain('border-radius')
    // never points at a remote origin
    expect(html).not.toMatch(/https?:\/\//)
  })
})

describe('Graph3D', () => {
  beforeEach(() => {
    mockWebProps = {}
    mockInjectSpy.mockClear()
  })

  it('shows a loader, then renders a WebView with the inlined library + data', async () => {
    render(
      <Graph3D nodes={nodes} edges={edges} colors={colors} edgeColor="#ccc" labelColor="#555" backgroundColor="#fff" filter="all" onSelect={jest.fn()} />
    )
    expect(screen.getByTestId('graph-loading')).toBeTruthy()
    await screen.findByTestId('graph-webview')
    expect(mockWebProps.source.html).toContain('LIBJS')
    expect(mockWebProps.source.html).toContain('Anxiety')
  })

  it('routes a node-tap message to onSelect and a background tap to null', async () => {
    const onSelect = jest.fn()
    render(
      <Graph3D nodes={nodes} edges={edges} colors={colors} edgeColor="#ccc" labelColor="#555" backgroundColor="#fff" filter="all" onSelect={onSelect} />
    )
    await screen.findByTestId('graph-webview')

    act(() => mockWebProps.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'node', id: 'n1' }) } }))
    expect(onSelect).toHaveBeenCalledWith(nodes[0])

    act(() => mockWebProps.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'bg' }) } }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('pushes the active filter into the graph once loaded', async () => {
    render(
      <Graph3D nodes={nodes} edges={edges} colors={colors} edgeColor="#ccc" labelColor="#555" backgroundColor="#fff" filter="emotion" onSelect={jest.fn()} />
    )
    await screen.findByTestId('graph-webview')
    act(() => mockWebProps.onLoadEnd())
    expect(mockInjectSpy).toHaveBeenCalledWith(expect.stringContaining('applyFilter("emotion")'))
  })
})
