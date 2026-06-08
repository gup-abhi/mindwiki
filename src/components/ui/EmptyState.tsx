import { StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { type Theme, useTheme, useThemedStyles } from '@/theme'

import { Text } from './Text'

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap
  title: string
  message?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm, padding: t.spacing['2xl'] },
    msg: { textAlign: 'center' },
  })

export function EmptyState({ icon, title, message }: EmptyStateProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <View style={styles.wrap}>
      {icon ? <Ionicons name={icon} size={40} color={theme.colors.textMuted} /> : null}
      <Text variant="subtitle" color="textSecondary">
        {title}
      </Text>
      {message ? (
        <Text variant="body" color="textMuted" style={styles.msg}>
          {message}
        </Text>
      ) : null}
    </View>
  )
}
