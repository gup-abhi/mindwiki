const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Bundle the 3d-force-graph library as a local text asset so the graph WebView
// runs fully offline (no CDN, no network) — see src/components/graph/Graph3D.tsx.
config.resolver.assetExts.push('txt')

module.exports = config
