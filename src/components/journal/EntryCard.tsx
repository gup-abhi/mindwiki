import { memo, useRef } from 'react'
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native'

import { Text } from '@/components/ui'
import { type Entry } from '@/services/storage/entries'
import { type Theme, moodColorKey, moodLabel, useThemedStyles } from '@/theme'
import { entryPreview } from '@/lib/entry-display'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

interface EntryCardProps {
  entry: Entry
  onPress: () => void
}

/** One entry in the timeline: a mood-colored bar, the time, its emotion · topic
 * tags, and a short preview of what was written. Memoized — lists re-render. */
function EntryCardBase({ entry, onPress }: EntryCardProps) {
  const styles = useThemedStyles(makeStyles)
  const androidPressStart = useRef<{ pageX: number; pageY: number } | null>(null)
  const androidPressMoved = useRef(false)
  const androidPressHandled = useRef(false)
  const moodOnly = entry.situation.trim() === '' && entry.thought.trim() === ''

  const handlePressIn = (event: GestureResponderEvent) => {
    if (Platform.OS !== 'android') return
    androidPressHandled.current = false
    androidPressMoved.current = false
    androidPressStart.current = {
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    }
  }

  const handlePressMove = (event: GestureResponderEvent) => {
    if (Platform.OS !== 'android') return
    const start = androidPressStart.current
    if (start == null) return
    const moved = Math.hypot(
      event.nativeEvent.pageX - start.pageX,
      event.nativeEvent.pageY - start.pageY
    )
    if (moved > 8) androidPressMoved.current = true
  }

  const handlePressOut = (event: GestureResponderEvent) => {
    if (Platform.OS !== 'android') return
    const start = androidPressStart.current
    const movedDuringPress = androidPressMoved.current
    androidPressStart.current = null
    androidPressMoved.current = false
    if (start == null) return
    if (movedDuringPress) return

    const moved = Math.hypot(
      event.nativeEvent.pageX - start.pageX,
      event.nativeEvent.pageY - start.pageY
    )
    if (moved > 8) return

    androidPressHandled.current = true
    onPress()
    setTimeout(() => {
      androidPressHandled.current = false
    }, 0)
  }

  const handleNativePress = () => {
    if (Platform.OS === 'android' && (androidPressHandled.current || androidPressStart.current != null)) {
      androidPressHandled.current = false
      return
    }
    onPress()
  }
  const preview = entryPreview(entry)
  const metadata = [
    moodLabel(entry.mood),
    entry.named_emotion,
    entry.emotion,
    entry.distortion && entry.distortion !== 'none' ? entry.distortion : null,
    entry.topic,
    entry.topic2,
  ].filter((value): value is string => !!value && value.trim() !== '')
  const seen = new Set<string>()
  const tags = metadata.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join(' · ')
  const accessibilityLabel = `${new Date(entry.created_at).toLocaleString()}, ${moodLabel(entry.mood)}${tags ? `, ${tags}` : ''}`

  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={handlePressIn}
      onTouchMove={handlePressMove}
      onPressOut={handlePressOut}
      onPress={handleNativePress}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <MoodBar mood={entry.mood} />
      <View style={styles.body}>
        <Text variant="caption" color="textMuted">
          {formatTime(entry.created_at)}
        </Text>
        {moodOnly ? (
          // A quick mood log carries no text — the mood itself is the content.
          <Text variant="body" color="textSecondary" style={styles.tags}>
            Mood check-in · {moodLabel(entry.mood)}
          </Text>
        ) : (
          <>
            {entry.tagged_at == null ? (
              <Text variant="caption" color="textMuted" style={styles.tags}>
                tagging…
              </Text>
            ) : null}
            <Text variant="label" color="accentText" style={styles.tags} numberOfLines={1}>
              {tags || moodLabel(entry.mood)}
            </Text>
            <View importantForAccessibility="no-hide-descendants">
              <Text
                variant="body"
                style={styles.preview}
                numberOfLines={2}
              >
                {preview}
              </Text>
            </View>
          </>
        )}
      </View>
    </Pressable>
  )
}

/** The mood-colored left bar. Its own component so the color token resolves
 * through the theme rather than an inline literal. */
function MoodBar({ mood }: { mood: number }) {
  const styles = useThemedStyles((t) =>
    StyleSheet.create({ bar: { width: 4, backgroundColor: t.colors[moodColorKey(mood)] } })
  )
  return <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no" />
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.md,
      marginHorizontal: t.spacing.xl,
      marginTop: t.spacing.md,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    pressed: { backgroundColor: t.colors.surfaceAlt },
    body: { flex: 1, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md },
    tags: { marginTop: 2 },
    preview: { marginTop: t.spacing.xs, lineHeight: 22 },
  })

export const EntryCard = memo(EntryCardBase)
