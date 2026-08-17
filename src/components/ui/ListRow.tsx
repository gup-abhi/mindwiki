import { type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type AccessibilityState } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'

import { Text } from './Text'

interface ListRowProps {
  title: string
  subtitle?: string
  onPress?: () => void
  right?: ReactNode
  accessibilityLabel?: string
  accessibilityState?: AccessibilityState
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.md,
      paddingVertical: t.spacing.md,
    },
    main: { flex: 1, gap: 2 },
    pressed: { opacity: 0.7 },
  })

/** A title (+ optional subtitle) row with an optional right accessory. */
export function ListRow({ title, subtitle, onPress, right, accessibilityLabel, accessibilityState, testID }: ListRowProps) {
  const styles = useThemedStyles(makeStyles)
  const content = (
    <>
      <View style={styles.main}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  )
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    )
  }
  return (
    <View style={styles.row} testID={testID}>
      {content}
    </View>
  )
}
