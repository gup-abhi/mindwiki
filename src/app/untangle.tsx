import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native'

import { CRISIS_RESOURCES } from '@/services/crisis/resources'
import { useRouter } from 'expo-router'

import { Button, Chip, IconButton, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useUntangleThought } from '@/hooks/useUntangleThought'

/**
 * Five-step CBT practice: Catch → Unhook → Spot → Check → Reframe.
 * The user writes only the thought; every other step is tappable selections.
 */
export default function UntangleScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const {
    step, stage, thought, patterns, selectedPatterns, observations, candidates,
    candidateLoading, matchedBelief, error,
    submitThought, next, previous, setSelectedPatterns, generateCandidates, finishReframe,
    cancel,
  } = useUntangleThought()

  const [input, setInput] = useState('')
  useEffect(() => {
    if (stage === 0 && step === 'idle' && thought) setInput(thought)
  }, [stage, step, thought])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [spotChoice, setSpotChoice] = useState<'none' | 'unsure' | null>(null)

  const handleStart = () => {
    void submitThought(input)
  }

  const handleCancel = () => {
    if (stage > 0 && step === 'ready') {
      previous()
      return
    }
    cancel()
    router.back()
  }

  const handleFinish = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(false)
    const saved = await finishReframe()
    setSaving(false)
    if (saved || !matchedBelief) router.back()
    else setSaveError(true)
  }

  const handleStageTransition = async () => {
    if (stage === 3) {
      next()
      await generateCandidates()
      return
    }
    next()
  }

  const handleCandidateRetry = async () => {
    await generateCandidates()
  }

  // Loading state
  if (step === 'loading') {
    return (
      <Screen>
        <View style={styles.center} testID="untangle-loading">
          <ActivityIndicator size="large" />
          <Text variant="body" color="textMuted">Thinking …</Text>
        </View>
      </Screen>
    )
  }

  // Crisis routing
  if (step === 'crisis') {
    return (
      <Screen>
        <View style={styles.center} testID="untangle-crisis-view">
          <Text variant="title">You are not alone</Text>
          <Text variant="body" color="textSecondary" style={styles.crisisText}>
            These feelings can be really heavy. It helps to talk to someone who
            understands.
          </Text>
          <Button
            title="Call or text 988"
            variant="destructive"
            fullWidth
            onPress={() => void Linking.openURL('tel:988')}
            testID="untangle-crisis-call"
          />
          {CRISIS_RESOURCES.slice(1).map((resource) => (
            <Text key={resource.name} variant="caption" color="textSecondary" style={styles.crisisResource}>
              {resource.name}: {resource.contact}
            </Text>
          ))}
          <Button title="← Back to Reflect" variant="ghost" onPress={() => router.back()} testID="untangle-back-button" />
        </View>
      </Screen>
    )
  }

  // Error state
  if (step === 'error' && error) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            Something didn't work. You can try again.
          </Text>
          <Button title="Try again" variant="ghost" onPress={handleStart} testID="untangle-retry-button" />
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Reflect" onPress={handleCancel}>
            <Text variant="label" color="accent">
              ← Back to Reflect
            </Text>
          </Pressable>
        </View>
      </Screen>
    )
  }

  // Step indicators (build the dot + label row)
  const stepLabels = ['Catch', 'Unhook', 'Spot', 'Check', 'Reframe']
  const stepEmojis = ['📝', '🧘', '🔍', '📋', '🔄']

  return (
    <Screen scroll animated={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back to Reflect"
          onPress={handleCancel}
          testID="untangle-cancel-button"
        />
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" variant="title">Untangle a thought</Text>
        </View>
      </View>

      <View style={styles.progress}>
        <ProgressBar
          progress={(stage + 1) / 5}
          testID="untangle-progress"
        />
      </View>

      {/* Step indicators */}
      <View style={styles.stepsRow}>
        {stepLabels.map((label, i) => (
          <View key={label} style={[styles.stepDot, i <= stage ? styles.activeStep : styles.inactiveStep]}>
            <Text variant="caption" color={i <= stage ? 'accent' : 'textMuted'}>
              {stepEmojis[i]}
            </Text>
          </View>
        ))}
      </View>

      {/* Stage 0: Catch */}
      {stage === 0 && step === 'idle' && (
        <View style={styles.stepContent}>
          <Text variant="title">What is your mind telling you right now?</Text>
          <TextField
            sensitive
            multiline
            value={input}
            onChangeText={setInput}
            placeholder="Write the thought that's bothering you …"
            testID="untangle-catch-input"
            style={styles.textField}
          />
          <Button
            title="Start"
            fullWidth
            disabled={!input.trim()}
            onPress={handleStart}
            testID="untangle-start-button"
          />
        </View>
      )}

      {/* Stage 1: Unhook */}
      {stage === 1 && step === 'ready' && (
        <View style={styles.stepContent}>
          <Text variant="title" testID="untangle-unhook-text">
            I'm noticing that my mind is telling me:{'\n'}
            <Text variant="body" color="textSecondary" style={styles.thoughtQuote}>
              “{thought}”
            </Text>
          </Text>
          <View style={styles.buttonWrap}>
            <Button
              title="Continue"
              fullWidth
              onPress={handleStageTransition}
              testID="untangle-next-button"
            />
          </View>
        </View>
      )}

      {/* Stage 2: Spot */}
      {stage === 2 && step === 'ready' && (
        <View style={styles.stepContent}>
          <Text variant="title">These patterns might fit:</Text>
          <Text variant="body" color="textMuted" style={styles.hint}>
            Tap any that feel true. These are suggestions, not verdicts.
          </Text>
          <View style={styles.chips}>
            {patterns.map((p) => (
              <Chip
                key={p}
                label={p}
                selected={selectedPatterns.includes(p)}
                onPress={() => {
                  setSpotChoice(null)
                  if (selectedPatterns.includes(p)) {
                    setSelectedPatterns(selectedPatterns.filter((s) => s !== p))
                  } else {
                    setSelectedPatterns([...selectedPatterns, p])
                  }
                }}
              />
            ))}
            <Chip
              label="None of these"
              selected={spotChoice === 'none'}
              onPress={() => {
                setSpotChoice('none')
                setSelectedPatterns([])
              }}
              testID="untangle-none-button"
            />
            <Chip
              label="I'm not sure"
              selected={spotChoice === 'unsure'}
              onPress={() => {
                setSpotChoice('unsure')
                setSelectedPatterns([])
              }}
              testID="untangle-unsure-button"
            />
          </View>
          <View style={styles.buttonWrap}>
            <Button
              title="Continue"
              fullWidth
              onPress={handleStageTransition}
              testID="untangle-next-button"
            />
          </View>
        </View>
      )}

      {/* Stage 3: Check */}
      {stage === 3 && step === 'ready' && (
        <View style={styles.stepContent}>
          <Text variant="title">What your wiki says</Text>
          {observations.length === 0 ? (
            <View testID="untangle-no-observations">
              <Text variant="body" color="textMuted">
                There isn't enough in your history to draw from yet. That's okay.
              </Text>
            </View>
          ) : (
            observations.map((obs) => (
              <View key={obs.pageId} style={styles.obsCard}>
                <Text variant="body" color="textSecondary">
                  {obs.excerpt}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open related wiki page"
                  onPress={() => router.push(`/wiki/${obs.pageId}`)}
                >
                  <Text variant="label" color="accent">
                    — {obs.title}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
          <View style={styles.buttonWrap}>
            <Button
              title="Continue"
              fullWidth
              onPress={handleStageTransition}
              testID="untangle-next-button"
            />
          </View>
        </View>
      )}

      {/* Stage 4: Reframe */}
      {stage === 4 && step === 'ready' && (
        <View style={styles.stepContent}>
          <Text variant="title">A more balanced view</Text>
          {candidates ? (
            <>
              {[candidates.factual, candidates.gentle, candidates.action].map((c, i) => (
                <View key={i} style={styles.candidateCard}>
                  <Text variant="body">
                    <Text variant="label" color="accent">
                      {['Factual', 'Gentle', 'Action'][i]}:
                    </Text>{' '}
                    {c}
                  </Text>
                </View>
              ))}
              <View style={styles.buttonWrap}>
                {saveError && (
                  <Text variant="body" color="danger" testID="untangle-save-error">
                    It couldn’t be saved. Your reframe is still here; try again.
                  </Text>
                )}
                <Button
                  title="Finish"
                  fullWidth
                  loading={saving}
                  onPress={() => void handleFinish()}
                  testID="untangle-finish-button"
                />
              </View>
            </>
          ) : candidateLoading ? (
            <View style={styles.center} testID="untangle-candidate-loading">
              <ActivityIndicator size="small" />
              <Text variant="body" color="textMuted">Generating alternatives …</Text>
            </View>
          ) : error ? (
            <View style={styles.center} testID="untangle-candidate-error">
              <Text variant="body" color="textMuted">
                Couldn’t prepare alternatives. Try again.
              </Text>
              <Button
                title="Try again"
                variant="ghost"
                onPress={() => void handleCandidateRetry()}
                testID="untangle-candidate-retry"
              />
            </View>
          ) : (
            <View style={styles.center}>
              <Text variant="body" color="textMuted">Couldn't prepare alternatives. Try again.</Text>
              <Button
                title="Try again"
                variant="ghost"
                onPress={() => void handleCandidateRetry()}
                testID="untangle-candidate-retry"
              />
            </View>
          )}
        </View>
      )}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
    header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, paddingTop: t.spacing.lg, marginBottom: t.spacing.md },
    headerContent: { flex: 1 },
    progress: { marginBottom: t.spacing.md },
    stepsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: t.spacing.xl,
    },
    stepDot: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    activeStep: { backgroundColor: t.colors.accent + '20' },
    inactiveStep: { backgroundColor: t.colors.surface },
    stepContent: { gap: t.spacing.md },
    textField: { minHeight: 100 },
    hint: { marginBottom: t.spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
    buttonWrap: { marginTop: t.spacing.xl },
    thoughtQuote: { fontStyle: 'italic', marginTop: t.spacing.sm },
    obsCard: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.md,
      padding: t.spacing.md,
      gap: t.spacing.xs,
    },
    candidateCard: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.md,
      padding: t.spacing.md,
    },
    crisisText: { textAlign: 'center', marginVertical: t.spacing.md },
    crisisResource: { marginTop: t.spacing.sm }
  })
