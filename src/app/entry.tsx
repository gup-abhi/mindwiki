import { useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Button, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useJournalEntry } from '@/hooks/useJournalEntry'

const MOODS = [1, 2, 3, 4, 5]
const MOOD_LABELS = ['Awful', 'Low', 'Okay', 'Good', 'Great']

export default function EntryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const j = useJournalEntry()

  async function onSave() {
    const result = await j.submit()
    if (!result.success) {
      Alert.alert('Could not save', result.error.message)
      return
    }
    if (result.data.crisis.tier > 0) {
      router.replace({ pathname: '/crisis', params: { tier: String(result.data.crisis.tier) } })
    } else {
      router.replace('/saved')
    }
  }

  const optional = j.step === 4 || j.step === 5

  return (
    <Screen padded={false}>
      <View style={styles.progressWrap}>
        <ProgressBar progress={j.step / j.totalSteps} />
        <Text variant="caption" color="textMuted" style={styles.stepLabel}>
          Step {j.step} of {j.totalSteps}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {j.step === 1 && (
          <View>
            <Text variant="heading" style={styles.q}>
              How are you feeling right now?
            </Text>
            <View style={styles.moodRow}>
              {MOODS.map((m) => {
                const active = j.draft.mood === m
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="button"
                    onPress={() => j.setMood(m)}
                    style={[styles.mood, active && styles.moodActive]}
                  >
                    <Text variant="subtitle" color={active ? 'primaryText' : 'textPrimary'}>
                      {m}
                    </Text>
                    <Text variant="caption" color={active ? 'primaryText' : 'textSecondary'}>
                      {MOOD_LABELS[m - 1]}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )}

        {j.step === 2 && (
          <Field
            label="What happened?"
            placeholder="Describe the situation…"
            value={j.draft.situation}
            onChangeText={(t) => j.setField('situation', t)}
          />
        )}

        {j.step === 3 && (
          <View>
            <Reference label="Situation" text={j.draft.situation} />
            <Field
              label="What went through your mind?"
              placeholder="The automatic thought…"
              value={j.draft.thought}
              onChangeText={(t) => j.setField('thought', t)}
            />
          </View>
        )}

        {j.step === 4 && (
          <Field
            label="What did you do? (optional)"
            placeholder="Your response…"
            value={j.draft.behavior}
            onChangeText={(t) => j.setField('behavior', t)}
          />
        )}

        {j.step === 5 && (
          <Field
            label="A balanced closing note (optional)"
            placeholder="A kinder perspective…"
            value={j.draft.closing_note}
            onChangeText={(t) => j.setField('closing_note', t)}
          />
        )}
      </ScrollView>

      <View style={styles.footer}>
        {j.step > 1 && <Button title="Back" variant="secondary" onPress={j.back} />}
        {optional && !j.isLastStep && <Button title="Skip" variant="ghost" onPress={j.skip} />}
        <View style={styles.grow}>
          {j.isLastStep ? (
            <Button title="Save entry" loading={j.submitting} fullWidth onPress={onSave} />
          ) : (
            <Button title="Next" disabled={!j.canAdvance} fullWidth onPress={j.next} />
          )}
        </View>
      </View>
    </Screen>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChangeText,
}: {
  label: string
  placeholder: string
  value: string
  onChangeText: (t: string) => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View>
      <Text variant="heading" style={styles.q}>
        {label}
      </Text>
      <TextField placeholder={placeholder} value={value} onChangeText={onChangeText} multiline />
    </View>
  )
}

function Reference({ label, text }: { label: string; text: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.reference}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="body" style={styles.referenceText}>
        {text}
      </Text>
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    progressWrap: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md },
    stepLabel: { marginTop: t.spacing.sm },
    body: { padding: t.spacing.xl, paddingBottom: t.spacing['2xl'] },
    q: { marginBottom: t.spacing.lg },
    moodRow: { flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm },
    mood: {
      flex: 1,
      paddingVertical: t.spacing.lg,
      borderRadius: t.radii.md,
      backgroundColor: t.colors.surfaceAlt,
      alignItems: 'center',
      gap: t.spacing.xs,
    },
    moodActive: { backgroundColor: t.colors.primary },
    reference: {
      backgroundColor: t.colors.surfaceSunken,
      borderRadius: t.radii.md,
      padding: t.spacing.md,
      marginBottom: t.spacing.lg,
    },
    referenceText: { marginTop: t.spacing.xs },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.md,
      padding: t.spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
    grow: { flex: 1 },
  })
