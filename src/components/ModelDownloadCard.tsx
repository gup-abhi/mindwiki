import { StyleSheet, View } from 'react-native'

import { Button, Card, ProgressBar, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useModelDownload } from '@/hooks/useModelDownload'

/**
 * Home nudge shown when the on-device AI models aren't present yet (e.g. a newly
 * paired device). Tagging, your insights, and "Ask your insights" all need them. Tapping
 * downloads both into the app's model dir (with a check so it never re-downloads).
 * Three states:
 *   1. No models at all → "Download AI models" prompt (same as before)
 *   2. Fast model ready, deep downloading → "Almost ready…" with secondary progress
 *   3. All models ready → renders nothing
 * Renders nothing while still checking (ready === null && canStart === null).
 */
export function ModelDownloadCard() {
  const styles = useThemedStyles(makeStyles)
  const { ready, canStart, downloading, progress, deepProgress, error, preference, download, defer } = useModelDownload()

  // Still checking — don't flicker.
  if (ready === null && canStart === null) return null

  // Fully ready — hide.
  if (ready === true) return null

  const showPrompt = !downloading && !error && canStart === false && preference !== 'consented'
  if (showPrompt) {
    return (
      <Card variant="accent" style={styles.card} testID="model-download-card">
        <Text variant="label" color="accentText">Private on-device AI</Text>
        <Text variant="caption" color="accentText" style={styles.sub}>
          Download about 3.2 GB for private tagging and deeper insight synthesis. Your journal stays on this device; only encrypted sync data can leave it.
        </Text>
        <View style={styles.actions}>
          <Button title="Download AI" size="sm" onPress={download} testID="model-download-start" />
          <Button title="Not now" size="sm" variant="ghost" onPress={defer} testID="model-download-defer" />
        </View>
      </Card>
    )
  }

  // Fast model present, deep downloading — show "almost ready" card.
  if (canStart === true) {
    return (
      <Card variant="accent" style={styles.card} testID="model-download-card">
        <Text variant="label" color="accentText">
          Almost ready…
        </Text>
        <Text variant="caption" color="accentText" style={styles.sub}>
          {deepProgress != null
            ? `Finishing up the deep model… ${Math.round(deepProgress * 100)}%`
            : 'Completing AI setup…'}
        </Text>
        {deepProgress != null && (
          <View style={styles.track}>
            <ProgressBar progress={deepProgress} />
          </View>
        )}
      </Card>
    )
  }

  return (
    <Card variant="accent" style={styles.card} testID="model-download-card">
      <Text variant="label" color="accentText">
        {error ? 'AI setup needs attention' : 'Setting up private AI'}
      </Text>
      {downloading ? (
        <>
          <Text variant="caption" color="accentText" style={styles.sub} accessibilityLiveRegion="polite">
            Downloading on-device models… {Math.round(progress * 100)}%
          </Text>
          <View style={styles.track}>
            <ProgressBar progress={progress} />
          </View>
        </>
      ) : (
        <>
          <Text variant="caption" color="accentText" style={styles.sub}>
            {error ?? 'The download stopped before it finished. Your journal is still available, and nothing was uploaded.'}
          </Text>
          <View style={styles.actions}>
            <Button title="Try again" size="sm" onPress={download} testID="model-download-retry" />
            <Button title="Not now" size="sm" variant="ghost" onPress={defer} testID="model-download-defer" />
          </View>
        </>
      )}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { marginTop: t.spacing.lg, alignSelf: 'stretch' },
    sub: { marginTop: t.spacing.xs },
    track: { marginTop: t.spacing.sm },
    actions: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.md },
  })
