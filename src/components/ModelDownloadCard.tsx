import { StyleSheet, View } from 'react-native'

import { Card, ProgressBar, Text } from '@/components/ui'
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
  const { ready, canStart, downloading, progress, deepProgress, error, download } = useModelDownload()

  // Still checking — don't flicker.
  if (ready === null && canStart === null) return null

  // Fully ready — hide.
  if (ready === true) return null

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

  // No models or error — show download prompt (same as before).
  return (
    <Card
      variant="accent"
      style={styles.card}
      onPress={downloading ? undefined : download}
      testID="model-download-card"
    >
      <Text variant="label" color="accentText">
        Download AI models
      </Text>
      {downloading ? (
        <>
          <Text variant="caption" color="accentText" style={styles.sub}>
            Downloading… {Math.round(progress * 100)}%
          </Text>
          <View style={styles.track}>
            <ProgressBar progress={progress} />
          </View>
        </>
      ) : (
        <Text variant="caption" color="accentText" style={styles.sub}>
          {error ??
            'Tagging, your insights, and Ask your insights run on-device AI (~2.8 GB). Download over Wi-Fi to enable them.'}
        </Text>
      )}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { marginTop: t.spacing.lg, alignSelf: 'stretch' },
    sub: { marginTop: t.spacing.xs },
    track: { marginTop: t.spacing.sm },
  })
