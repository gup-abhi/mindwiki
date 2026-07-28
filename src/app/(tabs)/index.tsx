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
import { computeStreak, streakRescue, weekActivity } from '@/services/notifications/streak'
import { homeMessage } from '@/services/notifications/home-message'
import { StreakCard } from '@/components/StreakCard'
import { WhatChangedCard } from '@/components/home/WhatChangedCard'
import { FirstPageReadyBanner } from '@/components/home/FirstPageReadyBanner'
import { lineageForEntry } from '@/services/wiki/engine'
import { type LineagePage } from '@/services/wiki/engine'
import { StreakRescueModal } from '@/components/StreakRescueModal'
import { SyncBanner } from '@/components/SyncBanner'
import { generateDigest } from '@/services/digest/generator'

// The streak-rescue popup interrupts at most once per app launch (it reappears on
// the next launch if the streak is still salvageable). Module scope so it survives
// re-mounting the Home screen within a session.
let rescuePromptShown = false

export default function Home() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { entries } = useEntries()
  const { count: journalCount } = useJournalEntryCount()
  const { pages } = useWikiPages()
  const { challenge, streak, doneToday, checkIn } = useChallenge()
  const { frozenDays, applyFreezes } = useStreakFreezes()
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
  const rescue = useMemo(
    () => streakRescue(timestamps, Date.now(), frozenDays),
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

  // Offer to save an at-risk streak once per launch.
  const [rescueOpen, setRescueOpen] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  useEffect(() => {
    if (rescue.atRisk && !rescuePromptShown) {
      rescuePromptShown = true
      setRescueOpen(true)
    }
  }, [rescue.atRisk])

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
            <WhatChangedCard pages={reshaped} />
            <FirstPageReadyBanner />
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
            <View style={[styles.recentHeader, reshaped && styles.recentHeaderCompact]}>
              <View>
                <Text variant="subtitle">Recent entries</Text>
                <Text variant="caption" color="textMuted">{journalCount} journal {journalCount === 1 ? 'entry' : 'entries'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="View all entries" onPress={() => router.push('/entries')} testID="home-view-all">
                <Text variant="label" color="accent">View all →</Text>
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
          </View>
        }
        />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New"
        accessibilityState={{ expanded: actionMenuOpen }}
        testID="home-new-entry"
        onPress={() => setActionMenuOpen((open) => !open)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Ionicons name="add" size={30} color={theme.colors.primaryText} />
      </Pressable>

      {actionMenuOpen && (
        <View style={styles.actionMenu} testID="home-action-menu">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Guided reflection"
            onPress={() => { setActionMenuOpen(false); router.push('/paths') }}
            style={({ pressed }) => [styles.actionButton, pressed && styles.fabPressed]}
            testID="home-action-guided-reflection"
          >
            <Ionicons name="compass-outline" size={22} color={theme.colors.primaryText} />
            <Text variant="bodyStrong" color="primaryText">Guided reflection</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Untangle a thought"
            onPress={() => { setActionMenuOpen(false); router.push('/untangle') }}
            style={({ pressed }) => [styles.actionButton, pressed && styles.fabPressed]}
            testID="home-action-untangle"
          >
            <Ionicons name="bulb-outline" size={22} color={theme.colors.primaryText} />
            <Text variant="bodyStrong" color="primaryText">Untangle a thought</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New entry"
            onPress={() => { setActionMenuOpen(false); router.push('/entry') }}
            style={({ pressed }) => [styles.actionButton, pressed && styles.fabPressed]}
            testID="home-action-new-entry"
          >
            <Ionicons name="create-outline" size={22} color={theme.colors.primaryText} />
            <Text variant="bodyStrong" color="primaryText">New entry</Text>
          </Pressable>
        </View>
      )}

      <StreakRescueModal
        visible={rescueOpen}
        streakLength={rescue.streakLength}
        freezesNeeded={rescue.freezesNeeded}
        onUse={() => {
          void applyFreezes(rescue.daysToFreeze)
          setRescueOpen(false)
        }}
        onDismiss={() => setRescueOpen(false)}
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // extra bottom space so the last entry clears the floating button
    listContent: { paddingBottom: t.spacing['3xl'] + t.spacing['2xl'] },
    header: { alignItems: 'center', paddingTop: t.spacing.lg, paddingBottom: t.spacing.sm, paddingHorizontal: t.spacing.xl },
    recentHeader: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.spacing['2xl'] },
    recentHeaderCompact: { marginTop: 0 },
    fullWidth: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    challengeBar: { marginTop: t.spacing.md },
    challengeAction: { flexDirection: 'row', marginTop: t.spacing.md },
    challengeDone: { marginTop: t.spacing.md },
    digestSub: { marginTop: t.spacing.xs },
    surfaceText: { marginTop: t.spacing.xs },
    synth: { marginTop: t.spacing.md },

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
    actionMenu: { position: 'absolute', left: 0, right: 0, bottom: t.spacing.xl + 64, alignItems: 'center', gap: t.spacing.sm },
    actionButton: { minWidth: 220, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingHorizontal: t.spacing.lg, borderRadius: 24, backgroundColor: t.colors.primary, ...t.shadows.low },
  })
