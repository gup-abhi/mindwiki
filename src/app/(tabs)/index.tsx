import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Card, Chip, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { EntryCard } from '@/components/journal/EntryCard'
import { groupEntriesByDay } from '@/components/journal/grouping'
import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { RecoverySetupCard } from '@/components/auth/RecoverySetupCard'
import { useChallenge } from '@/hooks/useChallenge'
import { useEntries } from '@/hooks/useEntries'
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
  const { entries, count } = useEntries()
  const { pages } = useWikiPages()
  const { challenge, streak, doneToday, checkIn } = useChallenge()
  const { frozenDays, useFreezes } = useStreakFreezes()
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
  useEffect(() => {
    if (rescue.atRisk && !rescuePromptShown) {
      rescuePromptShown = true
      setRescueOpen(true)
    }
  }, [rescue.atRisk])

  // Filter the timeline by emotion (the primary tag) and an inline text search.
  // Lifetime stats above stay on the full set; only the list below is filtered.
  const [emotion, setEmotion] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const emotions = useMemo(() => {
    const seen = new Set<string>()
    for (const e of entries) if (e.emotion) seen.add(e.emotion)
    return Array.from(seen).sort()
  }, [entries])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (emotion && e.emotion !== emotion) return false
      if (q) {
        const hay = `${e.situation} ${e.thought} ${e.behavior ?? ''} ${e.closing_note ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, emotion, query])

  // The search icon toggles the field; closing it clears the query.
  const toggleSearch = () =>
    setSearchOpen((open) => {
      if (open) setQuery('')
      return !open
    })
  const sections = useMemo(() => groupEntriesByDay(visible, Date.now()), [visible])

  return (
    <Screen padded={false}>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <Text variant="label" color="textSecondary" style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <SyncBanner />
            <StreakCard
              current={journalStreak.current}
              longest={journalStreak.longest}
              week={week}
              headline={headline}
              entries={count}
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
            <Card
              variant="sunken"
              style={styles.fullWidth}
              onPress={() => router.push('/paths')}
              testID="home-paths"
            >
              <Text variant="caption" color="accent">
                🧭 Guided reflections
              </Text>
              <Text variant="bodyStrong" style={styles.surfaceText}>
                Work through something, one prompt at a time
              </Text>
            </Card>
            {synthesizing && (
              <Text variant="caption" color="accent" style={styles.synth}>
                Synthesizing your insights…
              </Text>
            )}
            {entries.length > 0 && (
              <View style={styles.filterBar}>
                <Pressable
                  onPress={toggleSearch}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={searchOpen ? 'Close search' : 'Search entries'}
                  testID="home-search"
                  style={styles.searchBtn}
                >
                  <Ionicons
                    name={searchOpen ? 'close' : 'search'}
                    size={20}
                    color={searchOpen ? theme.colors.accent : theme.colors.textSecondary}
                  />
                </Pressable>
                {emotions.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                  >
                    <Chip
                      label="All"
                      selected={emotion === null}
                      onPress={() => setEmotion(null)}
                      testID="filter-all"
                    />
                    {emotions.map((em) => (
                      <Chip
                        key={em}
                        label={em}
                        selected={emotion === em}
                        onPress={() => setEmotion((cur) => (cur === em ? null : em))}
                        testID={`filter-${em}`}
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
            {searchOpen && (
              <View style={styles.searchField}>
                <TextField
                  placeholder="Search your entries"
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                  autoCapitalize="none"
                  returnKeyType="search"
                  testID="home-search-input"
                />
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <EntryCard entry={item} onPress={() => router.push(`/entries/${item.id}`)} />
        )}
        ListEmptyComponent={
          query.trim() !== '' ? (
            <Text variant="body" color="textMuted" style={styles.searchEmpty}>
              No entries match “{query.trim()}”.
            </Text>
          ) : null
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

      <StreakRescueModal
        visible={rescueOpen}
        streakLength={rescue.streakLength}
        freezesNeeded={rescue.freezesNeeded}
        onUse={() => {
          void useFreezes(rescue.daysToFreeze)
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
    fullWidth: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    challengeBar: { marginTop: t.spacing.md },
    challengeAction: { flexDirection: 'row', marginTop: t.spacing.md },
    challengeDone: { marginTop: t.spacing.md },
    digestSub: { marginTop: t.spacing.xs },
    surfaceText: { marginTop: t.spacing.xs },
    synth: { marginTop: t.spacing.md },
    filterBar: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, marginTop: t.spacing.xl },
    searchBtn: { paddingVertical: t.spacing.xs },
    filterRow: { gap: t.spacing.sm, paddingRight: t.spacing.xl },
    searchField: { alignSelf: 'stretch', marginTop: t.spacing.md },
    searchEmpty: { textAlign: 'center', marginTop: t.spacing['2xl'], paddingHorizontal: t.spacing.xl },
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
