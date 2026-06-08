import { StyleSheet, View } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'

interface ProgressBarProps {
  /** 0..1 */
  progress: number
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    track: { height: 6, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' },
    fill: { height: 6, borderRadius: t.radii.pill, backgroundColor: t.colors.accent },
  })

export function ProgressBar({ progress, testID }: ProgressBarProps) {
  const styles = useThemedStyles(makeStyles)
  const pct = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` as const
  return (
    <View style={styles.track} testID={testID}>
      <View style={[styles.fill, { width: pct }]} />
    </View>
  )
}
