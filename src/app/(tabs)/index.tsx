import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'

import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { RecoverySetupCard } from '@/components/auth/RecoverySetupCard'
import { useChallenge } from '@/hooks/useChallenge'
import { useCoverAffirmation } from '@/hooks/useCoverAffirmation'
import { useEntries } from '@/hooks/useEntries'
import { usePursuitCheckin } from '@/hooks/usePursuitCheckin'
import { useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'
import { computeStreak } from '@/services/notifications/streak'
import { streakStage } from '@/services/notifications/stage'
import { generateDigest } from '@/services/digest/generator'
import { suggestedQuestions } from '@/services/wiki/query'

export default function Home() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { entries, count } = useEntries()
  const { pages } = useWikiPages()
  const { checkin, open: openCheckin, dismiss: dismissCheckin } = usePursuitCheckin()
  const { challenge, streak, doneToday, checkIn } = useChallenge()
  const coverAffirmation = useCoverAffirmation()
  const synthesizing = useWikiStore((s) => s.pending > 0)
  const stage = useMemo(
    () => streakStage(computeStreak(entries.map((e) => e.created_at), Date.now()).current),
    [entries]
  )
  const digestReady = useMemo(() => generateDigest(entries, Date.now()) !== null, [entries])
  const surfacedQuestion = useMemo(() => suggestedQuestions(pages, 1)[0] ?? null, [pages])

  return (
    <Screen padded={false}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            {coverAffirmation ? (
              <Text variant="label" color="accent" style={styles.cover} testID="home-cover-affirmation">
                {coverAffirmation}
              </Text>
            ) : null}
            <Text variant="display">MindWiki</Text>
            <Text variant="label" color="accent" style={styles.stage}>
              {stage.headline}
            </Text>
            <ModelDownloadCard />
            <RecoverySetupCard />
            {digestReady && (
              <Card variant="accent" style={styles.fullWidth} onPress={() => router.push('/digest')}>
                <Text variant="subtitle" color="accentText">
                  Your weekly digest is ready
                </Text>
                <Text variant="caption" color="accentText" style={styles.digestSub}>
                  See your week at a glance →
                </Text>
              </Card>
            )}
            <View style={styles.cta}>
              <Button title="New entry" size="lg" fullWidth onPress={() => router.push('/entry')} />
            </View>
            {challenge && (
              <Card variant="sunken" style={styles.fullWidth} testID="home-challenge">
                <Pressable accessibilityRole="button" onPress={() => router.push('/challenge')}>
                  <Text variant="caption" color="accent">
                    🔥 Day {streak} of {challenge.target_days}
                  </Text>
                  <Text variant="bodyStrong" style={styles.surfaceText}>
                    {challenge.title}
                  </Text>
                  <View style={styles.challengeBar}>
                    <ProgressBar progress={streak / challenge.target_days} />
                  </View>
                </Pressable>
                {doneToday ? (
                  <Text variant="caption" color="textMuted" style={styles.challengeDone}>
                    Done for today ✓ — see you tomorrow.
                  </Text>
                ) : (
                  <View style={styles.challengeAction}>
                    <Button
                      title="I did it today"
                      size="sm"
                      onPress={() => void checkIn()}
                      testID="home-challenge-checkin"
                    />
                  </View>
                )}
              </Card>
            )}
            {checkin && (
              <Card variant="sunken" style={styles.fullWidth}>
                <Text variant="caption" color="accent">
                  Checking in
                </Text>
                <Text variant="body" style={styles.surfaceText}>
                  {checkin.checkin_question}
                </Text>
                <View style={styles.checkinActions}>
                  <Button title="Talk it through" size="sm" onPress={openCheckin} testID="checkin-open" />
                  <Button
                    title="Not now"
                    size="sm"
                    variant="ghost"
                    onPress={dismissCheckin}
                    testID="checkin-dismiss"
                  />
                </View>
              </Card>
            )}
            {surfacedQuestion && (
              <Card
                variant="sunken"
                style={styles.fullWidth}
                onPress={() => router.push({ pathname: '/query', params: { q: surfacedQuestion } })}
              >
                <Text variant="caption" color="accent">
                  Curious?
                </Text>
                <Text variant="body" style={styles.surfaceText}>
                  {surfacedQuestion}
                </Text>
              </Card>
            )}
            {synthesizing && (
              <Text variant="caption" color="accent" style={styles.synth}>
                Synthesizing your wiki…
              </Text>
            )}
            <Text variant="caption" color="textMuted" style={styles.count}>
              {count} {count === 1 ? 'entry' : 'entries'} so far
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => router.push(`/entries/${item.id}`)}
          >
            <Text variant="body" numberOfLines={1}>
              {item.situation}
            </Text>
            <Text variant="caption" color="textSecondary" style={styles.tags}>
              {item.emotion
                ? `${item.emotion} · ${item.distortion} · mood ${item.mood_score}`
                : 'tagging…'}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    listContent: { paddingBottom: t.spacing['2xl'] },
    header: { alignItems: 'center', paddingTop: t.spacing.lg, paddingBottom: t.spacing.xl, paddingHorizontal: t.spacing.xl },
    stage: { marginTop: t.spacing.sm, textAlign: 'center' },
    cover: { textAlign: 'center', marginBottom: t.spacing.md, fontStyle: 'italic' },
    fullWidth: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    challengeBar: { marginTop: t.spacing.md },
    challengeAction: { flexDirection: 'row', marginTop: t.spacing.md },
    challengeDone: { marginTop: t.spacing.md },
    digestSub: { marginTop: t.spacing.xs },
    cta: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    surfaceText: { marginTop: t.spacing.xs },
    checkinActions: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.md },
    synth: { marginTop: t.spacing.md },
    count: { marginTop: t.spacing.lg },
    row: {
      paddingHorizontal: t.spacing.xl,
      paddingVertical: t.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
    rowPressed: { backgroundColor: t.colors.surfaceAlt },
    tags: { marginTop: t.spacing.xs },
  })
