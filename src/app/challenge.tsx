import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, Card, IconButton, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useChallenge } from '@/hooks/useChallenge'
import { type Challenge, updateChallenge } from '@/services/storage/challenges'
import { toLocalDate } from '@/services/challenges/checkin'
import { setCoverAffirmation } from '@/services/challenges/cover'

const DAY_MS = 86_400_000

export default function ChallengeScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { challenge, loading, busy, streak, doneToday, create, checkIn, remove, refresh } =
    useChallenge()

  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  // The challenge just finished this session — held locally so the celebration +
  // affirmation render even though the hook clears the active challenge.
  const [completed, setCompleted] = useState<Challenge | null>(null)
  const [coverSet, setCoverSet] = useState(false)
  // Guards the check-in against a still-in-flight dev backdate write (the dev
  // buttons are fire-and-forget) so a fast tap can't read the pre-backdate date.
  const [devBusy, setDevBusy] = useState(false)

  const onStart = async () => {
    if (!title.trim()) return
    await create({ title: title.trim(), details: details.trim() })
  }

  const onCheckIn = async () => {
    const res = await checkIn()
    if (res?.decision.justCompleted) setCompleted(res.challenge)
  }

  const onSetCover = async () => {
    if (!completed) return
    await setCoverAffirmation(completed.affirmation)
    setCoverSet(true)
  }

  // Dev-only time travel so the day-by-day flow can be tested without changing
  // the device clock. Backdates last_checkin_date (and optionally the streak) so
  // the next real "I did it" behaves as if days had passed. Stripped from
  // production builds by the __DEV__ guard on the panel below.
  const devBackdate = async (daysAgo: number, streak?: number) => {
    if (!challenge) return
    setDevBusy(true)
    try {
      await updateChallenge(challenge.id, {
        last_checkin_date: toLocalDate(Date.now() - daysAgo * DAY_MS),
        ...(streak !== undefined ? { current_streak: streak } : {}),
      })
      await refresh()
    } finally {
      setDevBusy(false)
    }
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="challenge-back"
        />
        <Text variant="title">Challenge</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {completed ? (
          <View style={styles.celebrate} testID="challenge-complete">
            <Text variant="display" style={styles.center}>
              🎉
            </Text>
            <Text variant="title" style={styles.center}>
              {completed.target_days} days. You did it.
            </Text>
            <Card variant="accent" style={styles.affirmCard}>
              <Text variant="subtitle" color="accentText" style={styles.center}>
                {completed.affirmation}
              </Text>
            </Card>
            {coverSet ? (
              <Text variant="body" color="textSecondary" style={styles.center}>
                Added to your cover. You’ll see it each time you open MindWiki.
              </Text>
            ) : (
              <Button
                title="Set as my cover affirmation"
                fullWidth
                onPress={onSetCover}
                testID="challenge-set-cover"
              />
            )}
            <Button title="Done" variant="ghost" fullWidth onPress={() => router.back()} />
          </View>
        ) : loading ? null : challenge ? (
          <View testID="challenge-active">
            <Text variant="display">{challenge.title}</Text>
            {challenge.details ? (
              <Text variant="body" color="textSecondary" style={styles.detailsText}>
                {challenge.details}
              </Text>
            ) : null}

            <Text variant="subtitle" style={styles.dayCount}>
              Day {streak} of {challenge.target_days}
            </Text>
            <ProgressBar progress={streak / challenge.target_days} testID="challenge-progress" />

            <View style={styles.actions}>
              {doneToday ? (
                <Button
                  title="Done for today ✓"
                  fullWidth
                  disabled
                  onPress={() => {}}
                  testID="challenge-done-today"
                />
              ) : (
                <Button
                  title="I did it today"
                  size="lg"
                  fullWidth
                  loading={busy}
                  disabled={devBusy}
                  onPress={onCheckIn}
                  testID="challenge-checkin"
                />
              )}
            </View>

            {__DEV__ ? (
              <Card variant="sunken" style={styles.devPanel} testID="challenge-dev">
                <Text variant="caption" color="textMuted">
                  DEV · simulate days (no clock change)
                </Text>
                <View style={styles.devActions}>
                  <Button
                    title="+1 day"
                    size="sm"
                    variant="secondary"
                    disabled={devBusy || busy}
                    onPress={() => void devBackdate(1)}
                  />
                  <Button
                    title="Miss a day"
                    size="sm"
                    variant="secondary"
                    disabled={devBusy || busy}
                    onPress={() => void devBackdate(3)}
                  />
                  <Button
                    title="Jump to final day"
                    size="sm"
                    variant="secondary"
                    disabled={devBusy || busy}
                    onPress={() => void devBackdate(1, challenge.target_days - 1)}
                  />
                </View>
              </Card>
            ) : null}

            <Button
              title="Give up this challenge"
              variant="ghost"
              fullWidth
              onPress={remove}
              testID="challenge-give-up"
            />
            <Text variant="caption" color="textMuted" style={styles.center}>
              Miss a day and the streak starts over — that’s the challenge.
            </Text>
          </View>
        ) : (
          <View testID="challenge-create">
            <Text variant="body" color="textSecondary" style={styles.intro}>
              Pick one thing to do every day for 30 days. Tap to log each day — miss
              one and you start over.
            </Text>
            <View style={styles.field}>
              <TextField
                label="Your challenge"
                placeholder="e.g. Work out every day"
                value={title}
                onChangeText={setTitle}
                testID="challenge-title-input"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label="What does it involve? (optional)"
                placeholder="e.g. 20 minutes, any kind of movement"
                value={details}
                onChangeText={setDetails}
                multiline
                testID="challenge-details-input"
              />
            </View>
            <Button
              title="Start 30-day challenge"
              size="lg"
              fullWidth
              loading={busy}
              disabled={!title.trim()}
              onPress={onStart}
              testID="challenge-start"
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.lg },
    spacer: { width: 40 }, // balances the back button so the title stays centered
    body: { paddingBottom: t.spacing.xl },
    center: { textAlign: 'center' },
    intro: { marginBottom: t.spacing.xl, lineHeight: 22 },
    field: { marginBottom: t.spacing.lg },
    detailsText: { marginTop: t.spacing.sm },
    dayCount: { marginTop: t.spacing.xl, marginBottom: t.spacing.sm },
    actions: { marginTop: t.spacing.xl, marginBottom: t.spacing.md },
    celebrate: { gap: t.spacing.lg, alignItems: 'stretch', paddingTop: t.spacing.xl },
    affirmCard: { alignSelf: 'stretch' },
    devPanel: { marginTop: t.spacing.lg, gap: t.spacing.sm },
    devActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  })
