import { useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Button, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useReframes } from '@/hooks/useReframes'
import { useWikiPage } from '@/hooks/useWiki'

/**
 * Guided CBT thought-record for challenging a recurring belief: evidence for it,
 * evidence against it, and a more balanced thought (with an optional on-device AI
 * suggestion). Reached from the belief's wiki page.
 */
export default function ReframeScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { pageId } = useLocalSearchParams<{ pageId?: string }>()
  const { page, loading } = useWikiPage(pageId)
  const belief = page?.category === 'belief' ? page.title : ''
  const { save, suggest } = useReframes(belief || null)

  const [evidenceFor, setEvidenceFor] = useState('')
  const [evidenceAgainst, setEvidenceAgainst] = useState('')
  const [balanced, setBalanced] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const onSuggest = async () => {
    setSuggesting(true)
    const res = await suggest(evidenceFor, evidenceAgainst)
    setSuggesting(false)
    if (res && res.success) {
      setBalanced(res.data)
    } else {
      Alert.alert(
        'Couldn’t suggest a thought',
        'The on-device AI didn’t return a clean suggestion this time. You can write one yourself, or try again.'
      )
    }
  }

  const onSave = async () => {
    if (!balanced.trim()) return
    setSaving(true)
    const res = await save({
      evidence_for: evidenceFor,
      evidence_against: evidenceAgainst,
      balanced_thought: balanced,
    })
    setSaving(false)
    if (res && res.success) {
      router.back()
    } else {
      Alert.alert('Couldn’t save', 'Something went wrong saving your reframe. Please try again.')
    }
  }

  if (loading || !belief) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            No belief to reframe.
          </Text>
          <Text variant="label" color="accent" onPress={() => router.back()}>
            ← Back
          </Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll>
      <Text variant="label" color="accent" onPress={() => router.back()}>
        ← Back
      </Text>

      <Text variant="title" style={styles.heading}>
        Challenge this belief
      </Text>
      <Text variant="body" color="textSecondary" style={styles.belief}>
        “{belief}”
      </Text>

      <View style={styles.field}>
        <Text variant="label" color="textSecondary" style={styles.fieldLabel}>
          What makes this feel true? (evidence for)
        </Text>
        <TextField
          sensitive
          multiline
          value={evidenceFor}
          onChangeText={setEvidenceFor}
          placeholder="When does it show up, and what seems to back it up?"
          testID="reframe-evidence-for"
        />
      </View>

      <View style={styles.field}>
        <Text variant="label" color="textSecondary" style={styles.fieldLabel}>
          What doesn’t fit it? (evidence against)
        </Text>
        <TextField
          sensitive
          multiline
          value={evidenceAgainst}
          onChangeText={setEvidenceAgainst}
          placeholder="Times it wasn’t true, or that point the other way."
          testID="reframe-evidence-against"
        />
      </View>

      <View style={styles.field}>
        <View style={styles.balancedHeader}>
          <Text variant="label" color="textSecondary" style={styles.fieldLabel}>
            A more balanced thought
          </Text>
          <Button
            title={suggesting ? 'Thinking…' : '✨ Suggest'}
            variant="ghost"
            size="sm"
            loading={suggesting}
            onPress={() => void onSuggest()}
            testID="reframe-suggest"
          />
        </View>
        <TextField
          sensitive
          multiline
          value={balanced}
          onChangeText={setBalanced}
          placeholder="Something kinder and truer you can hold onto."
          testID="reframe-balanced"
        />
      </View>

      <Button
        title="Save reframe"
        fullWidth
        loading={saving}
        disabled={!balanced.trim()}
        onPress={() => void onSave()}
        testID="reframe-save"
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
    heading: { marginTop: t.spacing.md },
    belief: { marginTop: t.spacing.xs, marginBottom: t.spacing.xl, fontStyle: 'italic' },
    field: { marginBottom: t.spacing.xl },
    fieldLabel: { marginBottom: t.spacing.sm },
    balancedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  })
