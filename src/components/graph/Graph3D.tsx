import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { useTheme } from '@/theme'
import { type GraphNode, type GraphEdge, type NodeType } from '@/services/storage/graph'

// The 3d-force-graph (Three.js) library, vendored as a local text asset and run
// inside the WebView. Bundling it locally — rather than a CDN — keeps the graph
// fully offline: this WebView never makes a network request, so node labels
// (which are user-derived) never leave the device.
import forcegraphBundle from '../../../assets/graph/forcegraph.bundle.txt'

type Filter = NodeType | 'all'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  colors: Record<NodeType, string>
  edgeColor: string
  backgroundColor: string
  filter: Filter
  onSelect: (node: GraphNode | null) => void
}

interface GraphData {
  nodes: { id: string; type: NodeType; label: string; val: number }[]
  links: { source: string; target: string; weight: number }[]
}

/**
 * Build the self-contained HTML document for the WebView: the inlined library,
 * the graph data, and a small init script that wires ForceGraph3D with orbit
 * controls (one-finger rotate, two-finger pinch-to-zoom + pan) and reports node
 * taps back to React Native via postMessage. Pure — no I/O — so it's testable.
 */
export function buildGraphHtml(
  lib: string,
  data: GraphData,
  colors: Record<NodeType, string>,
  edgeColor: string,
  backgroundColor: string
): string {
  const init = [
    'const DATA = ' + JSON.stringify(data) + ';',
    'const COLORS = ' + JSON.stringify(colors) + ';',
    'const EDGE = ' + JSON.stringify(edgeColor) + ';',
    'const BG = ' + JSON.stringify(backgroundColor) + ';',
    'function post(m){ if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); } }',
    "const el = document.getElementById('graph');",
    "const G = ForceGraph3D({ controlType: 'orbit' })(el)",
    '  .backgroundColor(BG)',
    '  .graphData(DATA)',
    "  .nodeLabel('label')",
    "  .nodeVal('val')",
    "  .nodeColor(function(n){ return COLORS[n.type] || '#888888'; })",
    '  .nodeOpacity(0.95)',
    '  .nodeResolution(12)',
    '  .linkColor(function(){ return EDGE; })',
    '  .linkOpacity(0.5)',
    '  .linkWidth(function(l){ return Math.min(l.weight, 4) * 0.4; })',
    '  .showNavInfo(false)',
    "  .onNodeClick(function(n){ post({ type: 'node', id: n.id }); })",
    "  .onBackgroundClick(function(){ post({ type: 'bg' }); });",
    'function size(){ G.width(window.innerWidth).height(window.innerHeight); }',
    "size(); window.addEventListener('resize', size);",
    // Filtering happens here (driven from RN via injectJavaScript) so changing a
    // filter pill never reloads the WebView — it just swaps the graph data.
    'window.applyFilter = function(type){',
    "  var ns = type === 'all' ? DATA.nodes : DATA.nodes.filter(function(n){ return n.type === type; });",
    '  var ids = {}; ns.forEach(function(n){ ids[n.id] = true; });',
    '  var ls = DATA.links.filter(function(l){',
    '    var s = (l.source && l.source.id) || l.source; var t = (l.target && l.target.id) || l.target;',
    '    return ids[s] && ids[t];',
    '  });',
    '  G.graphData({ nodes: ns, links: ls });',
    '};',
    "post({ type: 'ready' });",
  ].join('\n')

  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:' + backgroundColor + ';}',
    '#graph{width:100vw;height:100vh;}canvas{touch-action:none;display:block;}</style>',
    '</head><body>',
    '<div id="graph"></div>',
    '<script>' + lib + '</script>',
    '<script>' + init + '</script>',
    '</body></html>',
  ].join('')
}

/**
 * Interactive 3D knowledge graph. Renders the nodes/edges with 3d-force-graph in
 * a WebView; gestures (rotate, pinch-zoom, pan) are handled natively by the
 * library. Node taps surface back through `onSelect`; filtering is applied live
 * without reloading. The whole thing runs offline — see the bundle note above.
 */
export function Graph3D({ nodes, edges, colors, edgeColor, backgroundColor, filter, onSelect }: Props) {
  const theme = useTheme()
  const webRef = useRef<WebView>(null)
  const [lib, setLib] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Read the vendored library once.
  useEffect(() => {
    let active = true
    ;(async () => {
      const asset = Asset.fromModule(forcegraphBundle)
      await asset.downloadAsync()
      if (!asset.localUri) return
      const text = await FileSystem.readAsStringAsync(asset.localUri)
      if (active) setLib(text)
    })()
    return () => {
      active = false
    }
  }, [])

  const html = useMemo(() => {
    if (!lib) return ''
    const data: GraphData = {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, val: Math.max(1, n.frequency) })),
      links: edges.map((e) => ({ source: e.source_id, target: e.target_id, weight: e.weight })),
    }
    return buildGraphHtml(lib, data, colors, edgeColor, backgroundColor)
  }, [lib, nodes, edges, colors, edgeColor, backgroundColor])

  // Push filter changes into the live graph (no reload). Re-runs on load so the
  // current filter is reapplied if the data (and thus the WebView) reloaded.
  useEffect(() => {
    if (!ready) return
    webRef.current?.injectJavaScript(`window.applyFilter(${JSON.stringify(filter)});true;`)
  }, [filter, ready])

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data) as { type: string; id?: string }
        if (msg.type === 'node') onSelect(nodes.find((n) => n.id === msg.id) ?? null)
        else if (msg.type === 'bg') onSelect(null)
      } catch {
        // ignore malformed messages
      }
    },
    [nodes, onSelect]
  )

  if (!lib) {
    return (
      <View style={styles.center} testID="graph-loading">
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    )
  }

  return (
    <WebView
      ref={webRef}
      testID="graph-webview"
      originWhitelist={['*']}
      source={{ html }}
      style={[styles.web, { backgroundColor }]}
      onMessage={onMessage}
      onLoadEnd={() => setReady(true)}
      javaScriptEnabled
      domStorageEnabled={false}
      scrollEnabled={false}
      setSupportMultipleWindows={false}
    />
  )
}

const styles = StyleSheet.create({
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
