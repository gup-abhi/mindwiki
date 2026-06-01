import { useRouter } from 'expo-router'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { useJournalEntry } from '@/hooks/useJournalEntry'

const MOODS = [1, 2, 3, 4, 5]
const MOOD_LABELS = ['Awful', 'Low', 'Okay', 'Good', 'Great']

export default function EntryScreen() {
  const router = useRouter()
  const j = useJournalEntry()

  async function onSave() {
    const result = await j.submit()
    if (result.success) {
      router.replace('/')
    } else {
      Alert.alert('Could not save', result.error.message)
    }
  }

  const optional = j.step === 4 || j.step === 5

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(j.step / j.totalSteps) * 100}%` }]} />
      </View>
      <Text style={styles.stepLabel}>
        Step {j.step} of {j.totalSteps}
      </Text>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {j.step === 1 && (
          <View>
            <Text style={styles.q}>How are you feeling right now?</Text>
            <View style={styles.moodRow}>
              {MOODS.map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  onPress={() => j.setMood(m)}
                  style={[styles.mood, j.draft.mood === m && styles.moodActive]}
                >
                  <Text style={styles.moodNum}>{m}</Text>
                  <Text style={styles.moodLabel}>{MOOD_LABELS[m - 1]}</Text>
                </Pressable>
              ))}
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
        {j.step > 1 && (
          <Pressable style={styles.secondary} onPress={j.back}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
        )}
        {optional && !j.isLastStep && (
          <Pressable style={styles.secondary} onPress={j.skip}>
            <Text style={styles.secondaryText}>Skip</Text>
          </Pressable>
        )}
        {j.isLastStep ? (
          <Pressable
            style={[styles.primary, j.submitting && styles.disabled]}
            onPress={onSave}
            disabled={j.submitting}
          >
            <Text style={styles.primaryText}>{j.submitting ? 'Saving…' : 'Save entry'}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primary, !j.canAdvance && styles.disabled]}
            onPress={j.next}
            disabled={!j.canAdvance}
          >
            <Text style={styles.primaryText}>Next</Text>
          </Pressable>
        )}
      </View>
    </View>
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
  return (
    <View>
      <Text style={styles.q}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        multiline
      />
    </View>
  )
}

function Reference({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.reference}>
      <Text style={styles.referenceLabel}>{label}</Text>
      <Text style={styles.referenceText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 24 },
  progressTrack: { height: 4, backgroundColor: '#eee', marginHorizontal: 20, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: '#1a1a2e', borderRadius: 2 },
  stepLabel: { marginHorizontal: 20, marginTop: 8, color: '#999', fontSize: 13 },
  body: { padding: 20, paddingBottom: 40 },
  q: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginBottom: 16 },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between' },
  mood: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
  },
  moodActive: { backgroundColor: '#1a1a2e' },
  moodNum: { fontSize: 20, fontWeight: '700', color: '#1a1a2e' },
  moodLabel: { fontSize: 11, color: '#666', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  reference: { backgroundColor: '#f7f7fb', borderRadius: 10, padding: 12, marginBottom: 16 },
  referenceLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  referenceText: { fontSize: 15, color: '#333' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  secondary: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
  },
  secondaryText: { color: '#1a1a2e', fontSize: 16, fontWeight: '600' },
  primary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
})
