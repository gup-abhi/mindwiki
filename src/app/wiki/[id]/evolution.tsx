import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { Button, Divider, Screen, Text } from '@/components/ui'
import { VersionTimeline } from '@/components/wiki/VersionTimeline'
import { VersionDiff } from '@/components/wiki/VersionDiff'
import { VersionViewer } from '@/components/wiki/VersionViewer'
import { type Theme, useThemedStyles } from '@/theme'
import { pageEvolution, type EvolutionVersion } from '@/services/wiki/evolution'

import { getPage } from '@/services/storage/wiki'
import { useWikiPage } from '@/hooks/useWiki'

type Mode = 'view' | 'compare'

const PLAYBACK_INTERVAL = 2500 // ms per version in playback

export default function PageEvolutionScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { page, loading } = useWikiPage(id)
  const [selected, setSelected] = useState<number | null>(null)
  const [compare, setCompare] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [isPlaying, setIsPlaying] = useState(false)

  // Build evolution data once the page loads
  const evo = useMemo(() => {
    if (!page || page.version_history.length === 0) return null
    return pageEvolution(page)
  }, [page])

  // All versions for the timeline (oldest-first)
  const timelineVersions = useMemo(() => {
    if (!evo) return []
    return [...evo.versions, evo.current]
  }, [evo])

  // The timeline consumes the same full archived + live chain normalization as
  // drift metrics, including a retained-history gap immediately before live vN.
  const timelineGaps = evo?.gaps ?? []

  // When a selected version's content + entry count
  const selectedVersion: EvolutionVersion | null = useMemo(() => {
    if (selected == null || !evo) return null
    const found = [...evo.versions, evo.current].find((v) => v.version === selected)
    return found ?? null
  }, [selected, evo])

  const compareVersion: EvolutionVersion | null = useMemo(() => {
    if (compare == null || !evo) return null
    const found = [...evo.versions, evo.current].find((v) => v.version === compare)
    return found ?? null
  }, [compare, evo])

  const onSelect = useCallback(
    (version: number) => {
      if (isPlaying) {
        setIsPlaying(false)
        return
      }
      if (mode === 'compare') {
        if (selected == null) {
          setSelected(version)
        } else if (compare == null) {
          setCompare(version)
        } else {
          // Reset: start fresh pair
          setSelected(version)
          setCompare(null)
        }
      } else {
        setSelected(version)
      }
    },
    [mode, selected, compare, isPlaying]
  )

  const toggleMode = useCallback(() => {
    if (mode === 'view') {
      setMode('compare')
      setSelected(null)
      setCompare(null)
    } else {
      setMode('view')
      setCompare(null)
    }
  }, [mode])

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    if (timelineVersions.length === 0) return
    // Start from the oldest version; the effect below drives the advance.
    setSelected(timelineVersions[0].version)
    setIsPlaying(true)
  }, [isPlaying, timelineVersions])

  // Drive playback: while playing, schedule a single advance to the next
  // version. Cleanup cancels the pending step, so pausing, tapping a dot, or
  // unmounting mid-playback stops it cleanly. Reaching the last version ends.
  useEffect(() => {
    if (!isPlaying) return
    const index = timelineVersions.findIndex((v) => v.version === selected)
    if (index < 0 || index >= timelineVersions.length - 1) {
      setIsPlaying(false)
      return
    }
    const timer = setTimeout(() => {
      setSelected(timelineVersions[index + 1].version)
    }, PLAYBACK_INTERVAL)
    return () => clearTimeout(timer)
  }, [isPlaying, selected, timelineVersions])

  const hasHistory = page != null && page.version_history.length > 0

  // Loading state
  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">Loading…</Text>
        </View>
      </Screen>
    )
  }

  // No page found
  if (!page) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">Page not found.</Text>
        </View>
      </Screen>
    )
  }

  // No history
  if (!hasHistory) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">This page hasn't evolved yet — write more entries and check back.</Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll>
      {/* Back */}
      <Text variant="label" color="accent" onPress={() => router.back()} testID="evolution-back">
        ← Back to page
      </Text>

      {/* Header */}
      <Text variant="title" style={styles.title}>
        {page.title}
      </Text>
      <Text variant="caption" color="textMuted" style={styles.meta}>
        {page.category ?? 'page'} · {page.version} versions · {page.entry_count}{' '}
        {page.entry_count === 1 ? 'entry' : 'entries'}
      </Text>

      {/* Action bar */}
      <View style={styles.actions}>
        {timelineVersions.length > 1 && (
          <Button
            title={isPlaying ? '⏸ Pause' : '▶ Play'}
            variant="ghost"
            size="sm"
            onPress={togglePlayback}
            testID="evolution-play"
          />
        )}
        <Button
          title={mode === 'compare' ? '⬡ View' : '⇄ Compare'}
          variant="ghost"
          size="sm"
          onPress={toggleMode}
          testID="evolution-mode"
        />
        {mode === 'compare' && (
          <Text variant="caption" color="accent" style={styles.compareHint}>
            Tap two versions to compare
          </Text>
        )}
      </View>

      {/* Timeline */}
      <View style={styles.timelineSection}>
        <VersionTimeline
          versions={timelineVersions}
          gaps={timelineGaps}
          selectedVersion={selected}
          compareVersion={compare}
          onSelect={onSelect}
        />
      </View>
      <Divider />

      {evo != null && (evo.issues.length > 0 || evo.gaps.length > 0) && (
        <View style={styles.integrityNotice} testID="evolution-integrity-notice">
          <Text variant="bodyStrong" color="textSecondary">
            History note
          </Text>
          {evo.issues.map((issue, index) => (
            <Text
              key={`${issue.type}-${issue.version}-${index}`}
              variant="caption"
              color="textMuted"
            >
              {issue.detail}
            </Text>
          ))}
          {evo.gaps.map((gap) => (
            <Text
              key={`gap-${gap.fromVersion}-${gap.toVersion}`}
              variant="caption"
              color="textMuted"
            >
              {gap.missing} prior version{gap.missing === 1 ? '' : 's'} were sampled out between v{gap.fromVersion} and v{gap.toVersion}.
            </Text>
          ))}
        </View>
      )}

      {/* Content area */}
      <View style={styles.contentSection}>
        {mode === 'compare' && selectedVersion && compareVersion ? (
          <>
            <Text variant="subtitle" style={styles.sectionTitle}>
              Changes from v{selectedVersion.version} → v{compareVersion.version}
            </Text>
            <VersionDiff
              contentA={selectedVersion.content}
              contentB={compareVersion.content}
            />
          </>
        ) : selectedVersion ? (
          <VersionViewer
            version={selectedVersion}
            entryCount={null}
          />
        ) : compareVersion ? (
          <VersionViewer
            version={compareVersion}
            entryCount={null}
          />
        ) : (
          <Text variant="body" color="textMuted" style={styles.hint}>
            Tap a version on the timeline to view it.
            {mode === 'compare' ? ' Tap a second version to compare.' : ''}
          </Text>
        )}
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: { marginTop: t.spacing.sm },
    meta: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginBottom: t.spacing.md,
      flexWrap: 'wrap',
    },
    compareHint: { flex: 1, textAlign: 'right' },
    timelineSection: { marginVertical: t.spacing.lg },
    contentSection: { marginTop: t.spacing.md, marginBottom: t.spacing.xl },
    integrityNotice: {
      gap: t.spacing.xs,
      marginTop: t.spacing.md,
      padding: t.spacing.sm,
      borderRadius: t.radii.sm,
      backgroundColor: t.colors.surfaceAlt,
    },
    sectionTitle: { marginBottom: t.spacing.sm },
    hint: { textAlign: 'center', marginTop: t.spacing.xl },
  })
