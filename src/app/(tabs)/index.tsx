import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, SectionList, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { EntryCard } from '@/components/journal/EntryCard'

import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { RecoverySetupCard } from '@/components/auth/RecoverySetupCard'
import { useChallenge } from '@/hooks/useChallenge'
import { useEntries, useJournalEntryCount } from '@/hooks/useEntries'
import { useStreakTimestamps } from '@/hooks/useStreakTimestamps'
import { useWikiPages } from '@/hooks/useWiki'
import { useStreakFreezes } from '@/hooks/useStreakFreezes'
import { useWikiStore } from '@/store/wiki.store'
import { computeStreak, weekActivity } from '@/services/notifications/streak'
import { homeMessage } from '@/services/notifications/home-message'
import { StreakCard } from '@/components/StreakCard'
import { WhatChangedCard } from '@/components/home/WhatChangedCard'
import { FirstPageReadyBanner } from '@/components/home/FirstPageReadyBanner'
import { lineageForEntry } from '@/services/wiki/engine'
import { type LineagePage } from '@/services/wiki/engine'
import { SyncBanner } from '@/components/SyncBanner'
import { generateDigest } from '@/services/digest/generator'

export default function Home() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { entries } = useEntries()
  const { count: journalCount } = useJournalEntryCount()
  const { pages } = useWikiPages()
  const { challenge, streak, doneToday, checkIn } = useChallenge()
  const { frozenDays } = useStreakFreezes()
  const synthesizing = useWikiStore((s) => s.pending > 0)
  // The streak counts journal entries AND completed guided-path answers, so it
  // reads a dedicated source, not the journal-only timeline (`entries`).
  const { timestamps } = useStreakTimestamps()
  const journalStreak = useMemo(
    () => computeStreak(timestamps, Date.now(), frozenDays),
    [timestamps, frozenDays]
  )
  const week = useMemo(() => weekActivity(timestamps, Date.now(), frozenDays), [timestamps, frozenDays])
  const headline = useMemo(
    () => homeMessage(timestamps, Date.now(), frozenDays),
    [timestamps, frozenDays]
  )
  const digestReady = useMemo(() => generateDigest(entries, Date.now()) !== null, [entries])

  // Which wiki pages the most recent tagged entry reshaped (compounding beat).
  // Falls back through entries until it finds one with topics set — avoids a blank
  // card when the very latest entry hasn't been tagged by the deep model yet.
  const [reshaped, setReshaped] = useState<LineagePage[] | null>(null)
  const taggedEntry = useMemo(() => entries.find((e) => e.topic || e.topic2), [entries])
  const lineageTarget = taggedEntry ?? entries[0]
  useEffect(() => {
    let active = true
    if (!lineageTarget) {
      setReshaped(null)
      return
    }
    lineageForEntry(lineageTarget).then((res) => {
      if (active) setReshaped(res.success ? res.data : null)
    })
    return () => { active = false }
  }, [lineageTarget])

  const recentEntries = entries.slice(0, 3)

  return (
    <Screen padded={false}>
      <SectionList
        sections={[]}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <SyncBanner />
            <ModelDownloadCard />
            <RecoverySetupCard />
            <StreakCard
              current={journalStreak.current}
              longest={journalStreak.longest}
              week={week}
              headline={headline}
              entries={journalCount}
              insights={pages.length}
              freezesAvailable={journalStreak.freezesAvailable}
              onPress={() => router.push('/trends')}
            />
            <View style={styles.pathActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Guided reflection"
                style={({ pressed }) => [styles.pathAction, pressed && styles.fabPressed]}
                onPress={() => router.push('/paths')}
                testID="home-action-guided-reflection"
              >
                <View style={styles.pathActionTitle}>
                  <Ionicons name="compass-outline" size={18} color={theme.colors.accent} />
                  <Text variant="label" color="accent">Guided reflection</Text>
                </View>
                <Text variant="caption" color="textMuted">
                  Work through gentle prompts, one step at a time.
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Untangle a thought"
                style={({ pressed }) => [styles.pathAction, pressed && styles.fabPressed]}
                onPress={() => router.push('/untangle')}
                testID="home-action-untangle"
              >
                <View style={styles.pathActionTitle}>
                  <Text variant="label" color="accent">🧩</Text>
                  <Text variant="label" color="accent">Untangle a thought</Text>
                </View>
                <Text variant="caption" color="textMuted">
                  Untangle a difficult thought, one step at a time.
                </Text>
              </Pressable>
            </View>
            <View style={styles.recentHeader}>
              <View>
                <Text variant="subtitle">Recent entries</Text>
                <Text variant="caption" color="textMuted">{journalCount} journal {journalCount === 1 ? 'entry' : 'entries'}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse and search entries"
                onPress={() => router.push('/entries')}
                testID="home-view-all"
              >
                <Text variant="label" color="accent">Browse & search →</Text>
              </Pressable>
            </View>
            {recentEntries.length === 0 ? (
              <Card variant="sunken" style={styles.fullWidth} onPress={() => router.push('/entry')} testID="home-empty-entries">
                <Text variant="bodyStrong" style={styles.surfaceText}>No entries yet</Text>
                <Text variant="caption" color="textMuted" style={styles.digestSub}>Start with a quick check-in.</Text>
              </Card>
            ) : (
              recentEntries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push(`/entries/${entry.id}`)} />)
            )}
            <WhatChangedCard pages={reshaped} pending={synthesizing} />
            <FirstPageReadyBanner />
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
          </View>
        }
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
    header: { alignItems: 'center', paddingTop: t.spacing.lg, paddingBottom: t.spacing.sm, paddingHorizontal: t.spacing.xl },
    recentHeader: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.spacing.md },
    fullWidth: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    challengeBar: { marginTop: t.spacing.md },
    challengeAction: { flexDirection: 'row', marginTop: t.spacing.md },
    challengeDone: { marginTop: t.spacing.md },
    digestSub: { marginTop: t.spacing.xs },
    surfaceText: { marginTop: t.spacing.xs },
    pathActions: { alignSelf: 'stretch', gap: t.spacing.sm, marginTop: t.spacing.sm, marginBottom: t.spacing.sm },
    pathAction: {
      padding: t.spacing.md,
      backgroundColor: t.colors.accent + '0F',
      borderRadius: t.radii.md,
      gap: t.spacing.xs,
    },
    pathActionTitle: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs },

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
