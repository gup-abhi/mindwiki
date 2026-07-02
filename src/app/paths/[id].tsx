import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Button, Chip, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'
import { useGuidedPath } from '@/hooks/useGuidedPath'

/**
 * Guided-path runner: steps through a path's prompts one at a time, with an
 * optional "go deeper" follow-up per step. On finish each answer is captured into
 * the wiki/graph and, if the answers surface a confident crisis signal, routes to
 * /crisis — safety parity with a journal save.
 */
export default function PathRunnerScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id: string }>()
  const p = useGuidedPath(id ?? '')
  const [completed, setCompleted] = useState(false)

  if (!p.path) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="heading">Reflection not found</Text>
          <Button title="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    )
  }

  if (completed) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="title" style={styles.doneTitle}>
            Nicely done
          </Text>
          <Text variant="body" color="textSecondary" style={styles.doneBody}>
            What you wrote is saved and woven into your wiki.
          </Text>
          <Button title="Done" fullWidth onPress={() => router.replace('/')} />
        </View>
      </Screen>
    )
  }

  const step = p.path.steps[p.stepIndex]

  const onFinish = async () => {
    const crisis = await p.finish()
    haptics.success()
    if (crisis.tier >= 2) {
      router.replace({
        pathname: '/crisis',
        params: { tier: String(crisis.tier), conf: String(crisis.confidence) },
      })
    } else {
      setCompleted(true)
    }
  }

  return (
    <Screen scroll>
      <ProgressBar progress={(p.stepIndex + 1) / p.stepCount} />
      <Text variant="caption" color="textMuted" style={styles.counter}>
        Step {p.stepIndex + 1} of {p.stepCount}
      </Text>

      <Text variant="heading" style={styles.prompt}>
        {step.prompt}
      </Text>
      {step.hint && (
        <Text variant="body" color="textSecondary" style={styles.hint}>
          {step.hint}
        </Text>
      )}

      <TextField
        placeholder="Take your time…"
        value={p.answer}
        onChangeText={p.setAnswer}
        multiline
        testID="path-answer"
      />

      {p.followUp && (
        <View style={styles.followUp} testID="path-followup">
          <Text variant="label" color="accent">
            Going deeper
          </Text>
          <Text variant="body" color="textSecondary" style={styles.followUpText}>
            {p.followUp}
          </Text>
        </View>
      )}

      <View style={styles.deeperRow}>
        <Chip
          label={p.deepening ? 'Thinking…' : '✨ Go deeper'}
          onPress={p.answer.trim() && !p.deepening ? () => void p.deepen() : undefined}
          testID="path-deepen"
        />
      </View>

      <View style={styles.footer}>
        {!p.isFirst && (
          <Button title="Back" variant="secondary" onPress={p.back} testID="path-back" />
        )}
        <View style={styles.footerGrow}>
          {p.isLast ? (
            <Button
              title="Finish"
              loading={p.submitting}
              fullWidth
              onPress={onFinish}
              testID="path-finish"
            />
          ) : (
            <Button title="Next" fullWidth onPress={p.next} testID="path-next" />
          )}
        </View>
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.lg },
    doneTitle: { textAlign: 'center' },
    doneBody: { textAlign: 'center', marginBottom: t.spacing.md },
    counter: { marginTop: t.spacing.sm },
    prompt: { marginTop: t.spacing.lg },
    hint: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    followUp: {
      marginTop: t.spacing.lg,
      padding: t.spacing.md,
      borderRadius: t.radii.md,
      backgroundColor: t.colors.accentMuted,
    },
    followUpText: { marginTop: t.spacing.xs },
    deeperRow: { flexDirection: 'row', marginTop: t.spacing.lg },
    footer: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, marginTop: t.spacing['2xl'] },
    footerGrow: { flex: 1 },
  })
