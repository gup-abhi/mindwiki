import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

/**
 * One-time display of the recovery phrase right after registration. The phrase is
 * never stored on-device, so this is the only chance to save it — a checkbox
 * gates "Continue" so the user can't blow past it. On confirm, the app enters.
 */
export function RecoveryPhraseView({ phrase, onConfirm }: { phrase: string; onConfirm: () => void }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [saved, setSaved] = useState(false)
  const words = phrase.split(' ')

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>
      <Text variant="heading">Save your recovery phrase</Text>
      <Text variant="body" color="textSecondary" style={styles.subtitle}>
        These 12 words are the only way back into your journal if you forget your password. We can't
        reset it for you. Write them down and keep them somewhere safe — never share them.
      </Text>

      <View style={styles.grid} testID="recovery-phrase-grid">
        {words.map((word, i) => (
          <View key={`${i}-${word}`} style={styles.wordChip}>
            <Text variant="caption" color="textMuted" style={styles.wordIndex}>
              {i + 1}
            </Text>
            <Text variant="bodyStrong">{word}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={styles.checkboxRow}
        onPress={() => setSaved((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved }}
        testID="recovery-saved-checkbox"
      >
        <Ionicons
          name={saved ? 'checkbox' : 'square-outline'}
          size={24}
          color={saved ? theme.colors.accent : theme.colors.textMuted}
        />
        <Text variant="body" style={styles.checkboxLabel}>
          I've written down my recovery phrase
        </Text>
      </Pressable>

      <View style={styles.continue}>
        <Button title="Continue" disabled={!saved} fullWidth onPress={onConfirm} testID="recovery-continue" />
      </View>
    </ScrollView>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.bg },
    body: { padding: t.spacing['2xl'], paddingTop: t.spacing['3xl'] },
    subtitle: { marginTop: t.spacing.sm },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: t.spacing.xl, gap: t.spacing.sm },
    wordChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.xs,
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.md,
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm + 2,
      minWidth: '45%',
    },
    wordIndex: { width: 22, fontVariant: ['tabular-nums'] },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.xl, gap: t.spacing.sm },
    checkboxLabel: { flexShrink: 1 },
    continue: { marginTop: t.spacing.xl },
  })
