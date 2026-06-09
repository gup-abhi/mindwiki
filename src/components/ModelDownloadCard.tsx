import { StyleSheet, View } from 'react-native'

import { Card, ProgressBar, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useModelDownload } from '@/hooks/useModelDownload'

/**
 * Home nudge shown when the on-device AI models aren't present yet (e.g. a newly
 * paired device). Tagging, the wiki, and "Ask your wiki" all need them. Tapping
 * downloads both into the app's model dir (with a check so it never re-downloads).
 * Renders nothing once the models are ready (or while still checking).
 */
export function ModelDownloadCard() {
  const styles = useThemedStyles(makeStyles)
  const { ready, downloading, progress, error, download } = useModelDownload()

  if (ready !== false) return null

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
            'Tagging, your wiki, and Ask your wiki run on-device AI (~2.8 GB). Download over Wi-Fi to enable them.'}
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
