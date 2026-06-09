import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { FlatList, StyleSheet, View } from 'react-native'

import { Button, Card, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { RecoverySetupCard } from '@/components/auth/RecoverySetupCard'
import { useEntries } from '@/hooks/useEntries'
import { useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'
import { computeStreak } from '@/services/notifications/streak'
import { streakStage } from '@/services/notifications/stage'
import { generateDigest } from '@/services/digest/generator'
import { suggestedQuestions } from '@/services/wiki/query'

export default function Home() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { entries, count } = useEntries()
  const { pages } = useWikiPages()
  const synthesizing = useWikiStore((s) => s.pending > 0)
  const stage = useMemo(
    () => streakStage(computeStreak(entries.map((e) => e.created_at), Date.now()).current),
    [entries]
  )
  const digestReady = useMemo(() => generateDigest(entries, Date.now()) !== null, [entries])
  const surfacedQuestion = useMemo(() => suggestedQuestions(pages, 1)[0] ?? null, [pages])

  return (
    <Screen padded={false}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="display">MindWiki</Text>
            <Text variant="label" color="accent" style={styles.stage}>
              {stage.headline}
            </Text>
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
            <View style={styles.cta}>
              <Button title="New entry" size="lg" fullWidth onPress={() => router.push('/entry')} />
            </View>
            {surfacedQuestion && (
              <Card
                variant="sunken"
                style={styles.fullWidth}
                onPress={() => router.push({ pathname: '/query', params: { q: surfacedQuestion } })}
              >
                <Text variant="caption" color="accent">
                  Curious?
                </Text>
                <Text variant="body" style={styles.surfaceText}>
                  {surfacedQuestion}
                </Text>
              </Card>
            )}
            {synthesizing && (
              <Text variant="caption" color="accent" style={styles.synth}>
                Synthesizing your wiki…
              </Text>
            )}
            <Text variant="caption" color="textMuted" style={styles.count}>
              {count} {count === 1 ? 'entry' : 'entries'} so far
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text variant="body" numberOfLines={1}>
              {item.situation}
            </Text>
            <Text variant="caption" color="textSecondary" style={styles.tags}>
              {item.emotion
                ? `${item.emotion} · ${item.distortion} · mood ${item.mood_score}`
                : 'tagging…'}
            </Text>
          </View>
        )}
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    listContent: { paddingBottom: t.spacing['2xl'] },
    header: { alignItems: 'center', paddingTop: t.spacing.lg, paddingBottom: t.spacing.xl, paddingHorizontal: t.spacing.xl },
    stage: { marginTop: t.spacing.sm, textAlign: 'center' },
    fullWidth: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    digestSub: { marginTop: t.spacing.xs },
    cta: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    surfaceText: { marginTop: t.spacing.xs },
    synth: { marginTop: t.spacing.md },
    count: { marginTop: t.spacing.lg },
    row: {
      paddingHorizontal: t.spacing.xl,
      paddingVertical: t.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
    tags: { marginTop: t.spacing.xs },
  })
