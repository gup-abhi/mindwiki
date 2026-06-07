import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

/**
 * One-time display of the recovery phrase right after registration. The phrase is
 * never stored on-device, so this is the only chance to save it — a checkbox
 * gates "Continue" so the user can't blow past it. On confirm, the app enters.
 */
export function RecoveryPhraseView({ phrase, onConfirm }: { phrase: string; onConfirm: () => void }) {
  const [saved, setSaved] = useState(false)
  const words = phrase.split(' ')

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>Save your recovery phrase</Text>
      <Text style={styles.subtitle}>
        These 12 words are the only way back into your journal if you forget your password. We can't
        reset it for you. Write them down and keep them somewhere safe — never share them.
      </Text>

      <View style={styles.grid} testID="recovery-phrase-grid">
        {words.map((word, i) => (
          <View key={`${i}-${word}`} style={styles.wordChip}>
            <Text style={styles.wordIndex}>{i + 1}</Text>
            <Text style={styles.word}>{word}</Text>
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
          color={saved ? '#1a1a2e' : '#999'}
        />
        <Text style={styles.checkboxLabel}>I've written down my recovery phrase</Text>
      </Pressable>

      <Pressable
        style={[styles.button, !saved && styles.buttonDisabled]}
        disabled={!saved}
        onPress={onConfirm}
        testID="recovery-continue"
      >
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { padding: 28, paddingTop: 64 },
  title: { fontSize: 26, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 15, color: '#666', marginTop: 8, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 24, gap: 10 },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4fb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: '45%',
  },
  wordIndex: { fontSize: 13, color: '#9a9ab8', width: 22, fontVariant: ['tabular-nums'] },
  word: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28, gap: 10 },
  checkboxLabel: { fontSize: 15, color: '#1a1a2e', flexShrink: 1 },
  button: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  buttonDisabled: { backgroundColor: '#b9b9cc' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
