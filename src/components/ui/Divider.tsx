import { StyleSheet, View } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    line: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.divider },
  })

export function Divider() {
  const styles = useThemedStyles(makeStyles)
  return <View style={styles.line} />
}
