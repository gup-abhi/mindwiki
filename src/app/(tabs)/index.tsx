import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, SectionList, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { EntryCard } from '@/components/journal/EntryCard'
import { groupEntriesByDay } from '@/components/journal/grouping'
import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { RecoverySetupCard } from '@/components/auth/RecoverySetupCard'
import { useChallenge } from '@/hooks/useChallenge'
import { useEntries } from '@/hooks/useEntries'
import { useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'
import { computeStreak, weekActivity } from '@/services/notifications/streak'
import { streakStage } from '@/services/notifications/stage'
import { StreakCard } from '@/components/StreakCard'
import { generateDigest } from '@/services/digest/generator'

export default function Home() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { entries, count } = useEntries()
  const { pages } = useWikiPages()
  const { challenge, streak, doneToday, checkIn } = useChallenge()
  const synthesizing = useWikiStore((s) => s.pending > 0)
  const journalStreak = useMemo(
    () => computeStreak(entries.map((e) => e.created_at), Date.now()),
    [entries]
  )
  const week = useMemo(() => weekActivity(entries.map((e) => e.created_at), Date.now()), [entries])
  const stage = useMemo(() => streakStage(journalStreak.current), [journalStreak])
  const digestReady = useMemo(() => generateDigest(entries, Date.now()) !== null, [entries])
  const sections = useMemo(() => groupEntriesByDay(entries, Date.now()), [entries])

  return (
    <Screen padded={false}>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <Text variant="label" color="textSecondary" style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <StreakCard
              current={journalStreak.current}
              longest={journalStreak.longest}
              week={week}
              headline={stage.headline}
              entries={count}
              insights={pages.length}
            />
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
            {synthesizing && (
              <Text variant="caption" color="accent" style={styles.synth}>
                Synthesizing your insights…
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <EntryCard entry={item} onPress={() => router.push(`/entries/${item.id}`)} />
        )}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New entry"
        testID="home-new-entry"
        onPress={() => router.push('/entry')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Ionicons name="add" size={30} color={theme.colors.primaryText} />
      </Pressable>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // extra bottom space so the last entry clears the floating button
    listContent: { paddingBottom: t.spacing['3xl'] + t.spacing['2xl'] },
    header: { alignItems: 'center', paddingTop: t.spacing.lg, paddingBottom: t.spacing.xl, paddingHorizontal: t.spacing.xl },
    fullWidth: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    challengeBar: { marginTop: t.spacing.md },
    challengeAction: { flexDirection: 'row', marginTop: t.spacing.md },
    challengeDone: { marginTop: t.spacing.md },
    digestSub: { marginTop: t.spacing.xs },
    surfaceText: { marginTop: t.spacing.xs },
    synth: { marginTop: t.spacing.md },
    sectionHeader: {
      paddingHorizontal: t.spacing.xl,
      paddingTop: t.spacing.lg,
      paddingBottom: t.spacing.xs,
      backgroundColor: t.colors.bg,
    },
    fab: {
      position: 'absolute',
      right: t.spacing.xl,
      bottom: t.spacing.xl,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 6,
    },
    fabPressed: { opacity: 0.85 },
  })
