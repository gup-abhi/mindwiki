import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, Card, Chip, IconButton, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { AffirmationCover } from '@/components/AffirmationCover'
import { useChallenge } from '@/hooks/useChallenge'
import { type Challenge } from '@/services/storage/challenges'
import { COVER_AFFIRMATION_TTL_MS, setCoverAffirmation } from '@/services/challenges/cover'

const COVER_DAYS = Math.round(COVER_AFFIRMATION_TTL_MS / 86_400_000)

export default function ChallengeScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { challenge, rewards, loading, busy, streak, doneToday, create, checkIn, remove } =
    useChallenge()
  // This tap will finish the challenge (and so generate the affirmation) when the
  // live streak is one short of the target and today isn't logged yet.
  const willComplete = challenge != null && !doneToday && streak === challenge.target_days - 1

  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  // The challenge just finished this session — held locally so the celebration +
  // affirmation render even though the hook clears the active challenge.
  const [completed, setCompleted] = useState<Challenge | null>(null)
  const [coverSet, setCoverSet] = useState(false)
  // A reward the user tapped to replay full-screen, or null.
  const [viewing, setViewing] = useState<string | null>(null)
  const [tab, setTab] = useState<'challenge' | 'rewards'>('challenge')

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

  return (
    <>
    <Screen scroll={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="challenge-back"
        />
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" variant="title">Challenge</Text>
        </View>
      </View>

      {completed ? (
        <ScrollView contentContainerStyle={styles.body}>
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
                Added to your cover — it’ll greet you each time you open MindWiki for the next{' '}
                {COVER_DAYS} days.
              </Text>
            ) : (
              <View style={styles.setCover}>
                <Button
                  title="Set as my cover affirmation"
                  fullWidth
                  onPress={onSetCover}
                  testID="challenge-set-cover"
                />
                <Text variant="caption" color="textMuted" style={styles.center}>
                  Greets you on every app open for {COVER_DAYS} days.
                </Text>
              </View>
            )}
            <Button title="Done" variant="ghost" fullWidth onPress={() => router.back()} />
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={styles.tabs}>
            <Chip
              label="Challenge"
              selected={tab === 'challenge'}
              onPress={() => setTab('challenge')}
              testID="tab-challenge"
            />
            <Chip
              label="Rewards"
              selected={tab === 'rewards'}
              onPress={() => setTab('rewards')}
              testID="tab-rewards"
            />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {tab === 'rewards' ? (
              rewards.length === 0 ? (
                <Text
                  variant="body"
                  color="textMuted"
                  style={styles.rewardsEmpty}
                  testID="challenge-rewards-empty"
                >
                  Finish a challenge to earn your first reward. It’ll live here.
                </Text>
              ) : (
                <View testID="challenge-rewards">
                  {rewards.map((r) => (
                    <Card
                      key={r.id}
                      variant="sunken"
                      style={styles.rewardCard}
                      onPress={() => setViewing(r.affirmation)}
                      testID="challenge-reward"
                    >
                      <Text variant="body" style={styles.rewardAffirmation}>
                        “{r.affirmation}”
                      </Text>
                      <Text variant="caption" color="textMuted" style={styles.rewardMeta}>
                        {r.title} · {r.target_days} days · {formatEarned(r.completed_at)}
                      </Text>
                    </Card>
                  ))}
                </View>
              )
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
                  onPress={onCheckIn}
                  testID="challenge-checkin"
                />
              )}
              {/* The final check-in generates the affirmation on-device, which
                  takes a moment — tell the user what the spinner is doing. */}
              {busy && willComplete ? (
                <Text variant="caption" color="accent" style={styles.crafting} testID="challenge-crafting">
                  Crafting your reward…
                </Text>
              ) : null}
            </View>

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
                sensitive
                label="Your challenge"
                placeholder="e.g. Work out every day"
                value={title}
                onChangeText={setTitle}
                testID="challenge-title-input"
              />
            </View>
            <View style={styles.field}>
              <TextField
                sensitive
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
        </>
      )}
    </Screen>
    {viewing != null ? (
      <AffirmationCover affirmation={viewing} onDismiss={() => setViewing(null)} />
    ) : null}
    </>
  )
}

/** Short, locale-friendly "earned on" date for a completed challenge. */
function formatEarned(completedAt: number | null): string {
  if (completedAt == null) return ''
  return new Date(completedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, paddingTop: t.spacing.lg, marginBottom: t.spacing.lg },
    headerContent: { flex: 1 },
    body: { paddingBottom: t.spacing.xl },
    center: { textAlign: 'center' },
    intro: { marginBottom: t.spacing.xl, lineHeight: 22 },
    field: { marginBottom: t.spacing.lg },
    detailsText: { marginTop: t.spacing.sm },
    dayCount: { marginTop: t.spacing.xl, marginBottom: t.spacing.sm },
    actions: { marginTop: t.spacing.xl, marginBottom: t.spacing.md },
    crafting: { textAlign: 'center', marginTop: t.spacing.md },
    celebrate: { gap: t.spacing.lg, alignItems: 'stretch', paddingTop: t.spacing.xl },
    affirmCard: { alignSelf: 'stretch' },
    setCover: { alignSelf: 'stretch', gap: t.spacing.sm },
    tabs: { flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.lg },
    rewardCard: { marginBottom: t.spacing.md },
    rewardAffirmation: { fontStyle: 'italic' },
    rewardMeta: { marginTop: t.spacing.sm },
    rewardsEmpty: { textAlign: 'center', marginTop: t.spacing.xl, lineHeight: 22 },
  })
