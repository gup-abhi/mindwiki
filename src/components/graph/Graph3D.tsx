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
  labelColor: string
  backgroundColor: string
  filter: Filter
  onSelect: (node: GraphNode | null) => void
}

interface GraphData {
  nodes: { id: string; type: NodeType; label: string; val: number }[]
  links: { source: string; target: string; weight: number }[]
}

/** `#RRGGBB` → `rgba(r,g,b,alpha)`; passes through anything it can't parse. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
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
  labelColor: string,
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
    // Always-on labels: an HTML overlay (one element per node) projected onto the
    // canvas each frame via graph2ScreenCoords. Crisp text, themeable, and no
    // extra library — sprites would need a second three.js instance.
    "const labelsEl = document.getElementById('labels');",
    'var CURRENT = DATA.nodes;',
    'var labelMap = {};',
    'function buildLabels(ns){',
    "  labelsEl.textContent = '';",
    '  labelMap = {};',
    '  ns.forEach(function(n){',
    "    var d = document.createElement('div'); d.className = 'lbl'; d.textContent = n.label;",
    '    labelsEl.appendChild(d); labelMap[n.id] = d;',
    '  });',
    '}',
    'function updateLabels(){',
    '  for (var i = 0; i < CURRENT.length; i++){',
    '    var n = CURRENT[i]; var el2 = labelMap[n.id]; if(!el2) continue;',
    "    if(n.x === undefined){ el2.style.opacity = '0'; continue; }",
    '    var c = G.graph2ScreenCoords(n.x, n.y, n.z);',
    "    el2.style.opacity = '1';",
    "    el2.style.transform = 'translate(-50%,-50%) translate(' + c.x + 'px,' + (c.y - 14) + 'px)';",
    '  }',
    '  requestAnimationFrame(updateLabels);',
    '}',
    'buildLabels(CURRENT); requestAnimationFrame(updateLabels);',
    // Filtering happens here (driven from RN via injectJavaScript) so changing a
    // filter pill never reloads the WebView — it just swaps the graph data.
    'window.applyFilter = function(type){',
    "  var ns = type === 'all' ? DATA.nodes : DATA.nodes.filter(function(n){ return n.type === type; });",
    '  var ids = {}; ns.forEach(function(n){ ids[n.id] = true; });',
    '  var ls = DATA.links.filter(function(l){',
    '    var s = (l.source && l.source.id) || l.source; var t = (l.target && l.target.id) || l.target;',
    '    return ids[s] && ids[t];',
    '  });',
    '  CURRENT = ns; buildLabels(ns);',
    '  G.graphData({ nodes: ns, links: ls });',
    '};',
    "post({ type: 'ready' });",
  ].join('\n')

  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:' + backgroundColor + ';}',
    '#graph{width:100vw;height:100vh;}canvas{touch-action:none;display:block;}',
    '#labels{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;}',
    '.lbl{position:absolute;top:0;left:0;white-space:nowrap;font-family:-apple-system,Roboto,system-ui,sans-serif;',
    'font-size:11px;font-weight:600;color:' + labelColor + ';',
    // A background pill keeps labels readable over any node color — a text
    // shadow in the bg color does nothing once the label sits on a node.
    'background:' + hexToRgba(backgroundColor, 0.82) + ';padding:1px 5px;border-radius:7px;will-change:transform;}',
    '</style>',
    '</head><body>',
    '<div id="graph"></div>',
    '<div id="labels"></div>',
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
export function Graph3D({ nodes, edges, colors, edgeColor, labelColor, backgroundColor, filter, onSelect }: Props) {
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
    return buildGraphHtml(lib, data, colors, edgeColor, labelColor, backgroundColor)
  }, [lib, nodes, edges, colors, edgeColor, labelColor, backgroundColor])

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
