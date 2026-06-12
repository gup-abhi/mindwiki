// Text assets bundled via metro (see metro.config.js assetExts). Imported for
// their asset module reference, then read at runtime with expo-asset.
declare module '*.txt' {
  const ref: number
  export default ref
}
