import { Pressable, StyleSheet, View } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'

import { Text } from './Text'

export interface SegmentOption {
  key: string
  label: string
  testID?: string
}

interface SegmentedControlProps {
  options: readonly SegmentOption[]
  selectedKey: string
  onChange: (key: string) => void
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.lg,
      padding: t.spacing.xs,
      marginBottom: t.spacing.sm,
    },
    segment: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.spacing.sm,
      borderRadius: t.radii.md,
    },
    selected: {
      backgroundColor: t.colors.accent,
      borderWidth: 1,
      borderColor: t.colors.accent,
    },
    pressed: { opacity: 0.8 },
  })

export function SegmentedControl({ options, selectedKey, onChange, testID }: SegmentedControlProps) {
  const styles = useThemedStyles(makeStyles)

  return (
    <View style={styles.container} accessibilityRole="tablist" testID={testID}>
      {options.map((option) => {
        const selected = option.key === selectedKey
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.key)}
            testID={option.testID ?? (testID ? `${testID}-${option.key}` : undefined)}
            style={({ pressed }) => [styles.segment, selected && styles.selected, pressed && styles.pressed]}
          >
            <Text variant="label" color={selected ? 'primaryText' : 'textSecondary'}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
