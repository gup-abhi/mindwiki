import { useEffect, useRef, useState } from 'react'
import { useNavigation, useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Chip, Screen, Text, TextField } from '@/components/ui'
import { MoodGrid } from '@/components/journal/MoodGrid'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'
import { randomPrompt } from '@/lib/journal-prompts'
import { feelingsForAffect } from '@/lib/feeling-words'
import { clearDraft, loadDraft, saveDraft } from '@/services/storage/draft'
import { type EntryDraft } from '@/store/entry.store'
import { useJournalEntry } from '@/hooks/useJournalEntry'

/** Any field set means there's unsaved work worth offering to keep as a draft. */
const hasContent = (d: EntryDraft): boolean =>
  d.mood != null || d.energy != null || !!d.emotion || !!d.body.trim() || !!d.thought.trim()

export default function EntryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const j = useJournalEntry()
  const navigation = useNavigation()
  const [prompt, setPrompt] = useState(() => randomPrompt())
  const [showThought, setShowThought] = useState(false)
  const feelings = feelingsForAffect(j.draft.mood, j.draft.energy)

  // Latest draft for the back listener (registered once); a real save / chosen
  // back action sets `leaving` so the listener doesn't re-prompt.
  const { reset, hydrate } = j
  const draftRef = useRef(j.draft)
  draftRef.current = j.draft
  const leaving = useRef(false)

  // Open blank, then restore a saved draft if one exists (resume-later).
  useEffect(() => {
    reset()
    void loadDraft().then((d) => {
      if (d) {
        hydrate(d)
        setShowThought(!!d.thought?.trim())
      }
    })
  }, [reset, hydrate])

  // Intercept back: offer to keep unsaved work as a draft.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (leaving.current || !hasContent(draftRef.current)) return
      e.preventDefault()
      Alert.alert('Keep this entry?', 'Save it as a draft and finish later, or discard it.', [
        {
          text: 'Save draft',
          onPress: async () => {
            await saveDraft(draftRef.current)
            leaving.current = true
            navigation.dispatch(e.data.action)
          },
        },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await clearDraft()
            leaving.current = true
            navigation.dispatch(e.data.action)
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ])
    })
    return sub
  }, [navigation])

  async function onSave() {
    leaving.current = true // a real save — don't prompt to keep a draft on the way out
    const result = await j.submit()
    if (!result.success) {
      leaving.current = false
      Alert.alert('Could not save', result.error.message)
      return
    }
    void clearDraft() // the entry is saved; drop any persisted draft
    haptics.success()
    // Only a confident signal (tier 2+) or an explicit keyword match (always tier 3)
    // takes over with the crisis screen. Tier 1 (confidence 0.30–0.59) is a soft,
    // low-confidence signal — too noisy from the small model to justify an
    // interstitial — so it saves normally; the /saved screen still offers a breather
    // on a low-mood day.
    if (result.data.crisis.tier >= 2) {
      router.replace({
        pathname: '/crisis',
        params: {
          tier: String(result.data.crisis.tier),
          // dev-only diagnostic readout (numbers only, never entry text)
          conf: String(result.data.crisis.confidence),
        },
      })
    } else {
      // Pass the mood so the confirmation can gently offer a breather on a low day.
      router.replace({ pathname: '/saved', params: { mood: String(result.data.entry.mood) } })
    }
  }

  return (
    <Screen padded={false} animated={false}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <MoodGrid pleasantness={j.draft.mood} energy={j.draft.energy} onPick={j.setAffect} />

        {feelings.length > 0 && (
          <View style={styles.feelingsWrap} testID="entry-feelings">
            <Text variant="label" color="accent" style={styles.feelingsLabel}>
              How does it feel?
            </Text>
            <View style={styles.feelings}>
              {feelings.map((f) => {
                const active = j.draft.emotion === f
                return (
                  <Chip
                    key={f}
                    label={f}
                    selected={active}
                    // Tap to name the feeling; tap again to clear it.
                    onPress={() => j.setEmotion(active ? null : f)}
                    testID={`feeling-${f}`}
                  />
                )
              })}
            </View>
          </View>
        )}

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

        {/* No autoFocus: the page opens on the grid so the user picks a cell →
            feeling → then taps here to write. Auto-focusing pops the keyboard and
            scrolls the grid off-screen. */}
        <TextField
          placeholder="Start writing…"
          value={j.draft.body}
          onChangeText={j.setBody}
          multiline
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
              autoFocus
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
    feelingsWrap: { marginTop: t.spacing.lg },
    feelingsLabel: { marginBottom: t.spacing.sm },
    feelings: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
    },
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
