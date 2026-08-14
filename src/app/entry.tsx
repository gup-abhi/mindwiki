import { useEffect, useRef, useState } from 'react'
import { useNavigation, useRouter } from 'expo-router'
import { Alert, AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native'
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

// The written text is the only thing worth protecting as a draft — losing it to
// an app switch or restart is the real cost. A bare grid/feeling pick isn't.
const hasText = (d: EntryDraft): boolean => !!d.body.trim() || !!d.thought.trim()
// Anything at all has been entered (controls the "Clear" affordance).
const hasAnything = (d: EntryDraft): boolean =>
  d.mood != null || d.energy != null || !!d.emotion || !!d.body.trim() || !!d.thought.trim()

// Two steps, each sized to fit the screen without scrolling. The grid + all the
// content together overflow a phone, and a scrolling entry screen hits an Android
// New-Arch (Fabric) bug where ScrollView children stop receiving touches once the
// content overflows. Splitting the flow keeps every screen scroll-free.
type Step = 'feel' | 'write'

export default function EntryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const j = useJournalEntry()
  const navigation = useNavigation()
  const [prompt, setPrompt] = useState(() => randomPrompt())
  const [showThought, setShowThought] = useState(false)
  const [step, setStep] = useState<Step>('feel')
  const feelings = feelingsForAffect(j.draft.mood, j.draft.energy)

  // Latest draft + step for the back listener (registered once); a real save / a
  // chosen back action sets `leaving` so the listener doesn't re-prompt.
  const { reset, hydrate } = j
  const draftRef = useRef(j.draft)
  draftRef.current = j.draft
  const stepRef = useRef(step)
  stepRef.current = step
  const leaving = useRef(false)

  // Open blank, then restore a saved draft if one exists (resume-later). A draft
  // only exists when there was written text, so jump straight to the writing step.
  useEffect(() => {
    reset()
    void loadDraft().then((d) => {
      if (d) {
        hydrate(d)
        setShowThought(!!d.thought?.trim())
        setStep('write')
      }
    })
  }, [reset, hydrate])

  // Persist the draft whenever the app goes to the background, so text survives an
  // app switch or an OS kill — not just an explicit back-out. Only when there's
  // text worth keeping.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && hasText(draftRef.current)) void saveDraft(draftRef.current)
    })
    return () => sub.remove()
  }, [])

  // Intercept back: from the writing step, step back to the feeling step rather
  // than leaving; from the feeling step, offer to keep any written text as a draft.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (leaving.current) return
      if (stepRef.current === 'write') {
        e.preventDefault()
        setStep('feel')
        return
      }
      if (!hasText(draftRef.current)) return
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
      router.replace({
        pathname: '/saved',
        params: {
          id: result.data.entry.id,
          mood: String(result.data.entry.mood),
        },
      })
    }
  }

  function onClear() {
    Alert.alert('Clear this entry?', 'This removes everything you’ve entered, including the saved draft.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          reset()
          setShowThought(false)
          setStep('feel')
          void clearDraft()
        },
      },
    ])
  }

  // Step 1 — the mood grid and the named feeling. Fits without scrolling.
  if (step === 'feel') {
    return (
      <Screen padded={false} animated={false}>
        <View style={styles.content}>
          {hasAnything(j.draft) && (
            <View style={styles.topBar}>
              <Text variant="label" color="accent" onPress={onClear} testID="entry-clear">
                Clear
              </Text>
            </View>
          )}

          {/* First-time hint: the grid isn't self-explanatory. Drop it once a
              cell is picked so it doesn't linger. */}
          {j.draft.mood == null && (
            <Text variant="caption" color="textMuted" style={styles.gridHint}>
              Tap the square that best matches how you feel right now.
            </Text>
          )}

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
        </View>

        <View style={styles.footer}>
          <Button
            title="Continue"
            disabled={!j.canSave}
            fullWidth
            onPress={() => {
              haptics.select()
              setStep('write')
            }}
            testID="entry-continue"
          />
        </View>
      </Screen>
    )
  }

  // Step 2 — the optional written reflection. Also fits without scrolling, and
  // lifts above the keyboard so the field stays visible.
  return (
    <Screen padded={false} animated={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Pressable
            style={styles.backRow}
            onPress={() => setStep('feel')}
            testID="entry-back"
            accessibilityRole="button"
            accessibilityLabel="Back to how you’re feeling"
          >
            <Ionicons name="chevron-back" size={18} color={theme.colors.accent} />
            <Text variant="label" color="accent">
              How you’re feeling
            </Text>
          </Pressable>

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
            sensitive
            placeholder="Start writing… (optional)"
            value={j.draft.body}
            onChangeText={j.setBody}
            multiline
            // The write step has no parent ScrollView (split flow dodges the
            // Android New-Arch touch bug — see the comment in TextField). So
            // let the field scroll its own content and cap its height, so long
            // text stays reachable instead of overflowing the screen.
            scrollEnabled
            style={styles.bodyInput}
            testID="entry-body"
          />

          {showThought ? (
            <View style={styles.thought}>
              <Text variant="label" color="accent" style={styles.thoughtLabel}>
                The thought behind this
              </Text>
              <TextField
                sensitive
                placeholder="The automatic thought…"
                value={j.draft.thought}
                onChangeText={j.setThought}
                multiline
                // Same reasoning as the body field — no parent ScrollView on
                // this step, so internal scroll is safe.
                scrollEnabled
                style={styles.thoughtInput}
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
        </View>

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
      </KeyboardAvoidingView>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { flex: 1, padding: t.spacing.xl },
    gridHint: { textAlign: 'center', marginBottom: t.spacing.md },
    topBar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: t.spacing.sm },
    feelingsWrap: { marginTop: t.spacing.lg },
    feelingsLabel: { marginBottom: t.spacing.sm },
    feelings: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
    },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.xs,
      marginBottom: t.spacing.md,
    },
    promptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginBottom: t.spacing.md,
    },
    prompt: { flex: 1 },
    bodyInput: { maxHeight: 240 },
    thought: { marginTop: t.spacing.xl },
    thoughtInput: { maxHeight: 180 },
    thoughtLabel: { marginBottom: t.spacing.xs },
    addThought: { marginTop: t.spacing.lg, flexDirection: 'row' },
    footer: {
      padding: t.spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
  })
