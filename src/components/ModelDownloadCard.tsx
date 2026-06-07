import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useModelDownload } from '@/hooks/useModelDownload'

/**
 * Home nudge shown when the on-device AI models aren't present yet (e.g. a newly
 * paired device). Tagging, the wiki, and "Ask your wiki" all need them. Tapping
 * downloads both into the app's model dir (with a check so it never re-downloads).
 * Renders nothing once the models are ready (or while still checking).
 */
export function ModelDownloadCard() {
  const { ready, downloading, progress, error, download } = useModelDownload()

  if (ready !== false) return null

  return (
    <Pressable
      accessibilityRole="button"
      style={styles.card}
      onPress={downloading ? undefined : download}
      disabled={downloading}
      testID="model-download-card"
    >
      <Text style={styles.title}>Download AI models</Text>
      {downloading ? (
        <>
          <Text style={styles.sub}>Downloading… {Math.round(progress * 100)}%</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </>
      ) : (
        <Text style={styles.sub}>
          {error ??
            'Tagging, your wiki, and Ask your wiki run on-device AI (~2.8 GB). Download over Wi-Fi to enable them.'}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    backgroundColor: '#eaf2fb',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: '#cfe0f3',
  },
  title: { fontSize: 15, color: '#1a4a7a', fontWeight: '700' },
  sub: { fontSize: 13, color: '#2a5a8a', marginTop: 4, lineHeight: 19 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#cfe0f3', marginTop: 10, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: '#1a4a7a' },
})
