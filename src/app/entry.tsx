import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Chip, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'
import { randomPrompt } from '@/lib/journal-prompts'
import { useJournalEntry } from '@/hooks/useJournalEntry'

const MOODS = [1, 2, 3, 4, 5]
const MOOD_EMOJI = ['😣', '😕', '😐', '🙂', '😄']
const MOOD_LABELS = ['Awful', 'Low', 'Okay', 'Good', 'Great']

export default function EntryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const j = useJournalEntry()
  const [prompt, setPrompt] = useState(() => randomPrompt())
  const [showThought, setShowThought] = useState(false)

  async function onSave() {
    const result = await j.submit()
    if (!result.success) {
      Alert.alert('Could not save', result.error.message)
      return
    }
    haptics.success()
    if (result.data.crisis.tier > 0) {
      router.replace({ pathname: '/crisis', params: { tier: String(result.data.crisis.tier) } })
    } else {
      router.replace('/saved')
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.moodRow}>
          {MOODS.map((m) => {
            const active = j.draft.mood === m
            return (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityLabel={MOOD_LABELS[m - 1]}
                testID={`mood-${m}`}
                onPress={() => {
                  haptics.select()
                  j.setMood(m)
                }}
                style={[styles.mood, active && styles.moodActive]}
              >
                <Text variant="title" style={styles.moodEmoji}>
                  {MOOD_EMOJI[m - 1]}
                </Text>
                <Text variant="caption" color={active ? 'accentText' : 'textMuted'}>
                  {MOOD_LABELS[m - 1]}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Pressable
          style={styles.promptRow}
          onPress={() => setPrompt((p) => randomPrompt(p))}
          testID="entry-shuffle"
          accessibilityRole="button"
          accessibilityLabel="Show another prompt"
        >
          <Text variant="heading" color="textSecondary" style={styles.prompt}>
            {prompt}
          </Text>
          <Ionicons name="refresh" size={18} color={theme.colors.textMuted} />
        </Pressable>

        <TextField
          placeholder="Start writing…"
          value={j.draft.body}
          onChangeText={j.setBody}
          multiline
          autoFocus
          testID="entry-body"
        />

        {showThought ? (
          <View style={styles.thought}>
            <Text variant="label" color="accent" style={styles.thoughtLabel}>
              The thought behind this
            </Text>
            <TextField
              placeholder="The automatic thought…"
              value={j.draft.thought}
              onChangeText={j.setThought}
              multiline
              testID="entry-thought"
            />
          </View>
        ) : (
          <View style={styles.addThought}>
            <Chip
              label="✨ Add the thought behind this"
              onPress={() => setShowThought(true)}
              testID="entry-add-thought"
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Save entry"
          loading={j.submitting}
          disabled={!j.canSave}
          fullWidth
          onPress={onSave}
          testID="entry-save"
        />
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    body: { padding: t.spacing.xl, paddingBottom: t.spacing['2xl'] },
    moodRow: { flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm },
    mood: {
      flex: 1,
      paddingVertical: t.spacing.md,
      borderRadius: t.radii.md,
      backgroundColor: t.colors.surfaceAlt,
      alignItems: 'center',
      gap: t.spacing.xs,
    },
    moodActive: { backgroundColor: t.colors.accentMuted },
    moodEmoji: { lineHeight: 34 },
    promptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginTop: t.spacing['2xl'],
      marginBottom: t.spacing.md,
    },
    prompt: { flex: 1 },
    thought: { marginTop: t.spacing.xl },
    thoughtLabel: { marginBottom: t.spacing.xs },
    addThought: { marginTop: t.spacing.lg, flexDirection: 'row' },
    footer: {
      padding: t.spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
  })
