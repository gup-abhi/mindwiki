import { useLocalSearchParams, useRouter } from 'expo-router'
import { Linking, Pressable, StyleSheet, View } from 'react-native'

import { Button, Card, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { CRISIS_RESOURCES } from '@/services/crisis/resources'

// Supportive, non-diagnostic copy that scales with severity. The app offers
// support resources only — it does not diagnose or treat.
const COPY: Record<number, { title: string; body: string }> = {
  1: {
    title: 'Thanks for writing this down',
    body: 'It sounds like things feel heavy right now. If it would help, support is always here.',
  },
  2: {
    title: "You don't have to go through this alone",
    body: 'What you’re feeling matters. Talking to someone can help — these services are free and confidential.',
  },
  3: {
    title: 'Please reach out — you matter',
    body: 'If you’re thinking about harming yourself, you’re not alone and help is available right now.',
  },
}

export default function CrisisScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { tier, conf } = useLocalSearchParams<{ tier?: string; conf?: string }>()
  const t = Number(tier) || 1
  const copy = COPY[t] ?? COPY[1]
  // Tier 1 is a low-confidence signal — keep it calm: no red 988 button and no
  // full resource list, just a quiet line that support exists. Tiers 2–3 show
  // the full crisis screen.
  const showFullSupport = t >= 2

  return (
    <Screen scroll>
      <Text variant="heading">{copy.title}</Text>
      <Text variant="body" color="textSecondary" style={styles.bodyText}>
        {copy.body}
      </Text>

      {__DEV__ && conf != null && (
        <Text variant="caption" color="textSecondary" style={styles.debug}>
          debug · tier {t} · model confidence {Number(conf).toFixed(2)}
        </Text>
      )}

      {showFullSupport ? (
        <>
          <View style={styles.callWrap}>
            <Button
              title="Call or text 988"
              variant="destructive"
              fullWidth
              onPress={() => Linking.openURL('tel:988')}
            />
          </View>

          {CRISIS_RESOURCES.map((r) => (
            <Card key={r.name} style={styles.resource}>
              <Text variant="subtitle">{r.name}</Text>
              <Text variant="body" style={styles.resourceContact}>
                {r.contact}
              </Text>
              <Text variant="caption" color="textSecondary" style={styles.resourceDesc}>
                {r.description}
              </Text>
            </Card>
          ))}
        </>
      ) : (
        <Pressable style={styles.softLink} onPress={() => Linking.openURL('tel:988')}>
          <Text variant="bodyStrong" color="accent">
            If you ever want to talk, 988 is there — call or text, anytime.
          </Text>
        </Pressable>
      )}

      {/* A calm grounding option for tiers 1–2. At tier 3 the priority is staying
          with 988 + resources, so we don't offer it there. */}
      {t < 3 && (
        <View style={styles.breatheWrap}>
          <Button
            title="Try a breathing exercise"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/breathe')}
            testID="crisis-breathe"
          />
        </View>
      )}

      <View style={styles.continueWrap}>
        <Button title="Continue" variant="ghost" fullWidth onPress={() => router.replace('/')} />
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    bodyText: { marginTop: t.spacing.md },
    debug: { marginTop: t.spacing.sm, fontStyle: 'italic', opacity: 0.6 },
    callWrap: { marginTop: t.spacing.xl },
    resource: { marginTop: t.spacing.md },
    resourceContact: { marginTop: t.spacing.xs },
    resourceDesc: { marginTop: t.spacing.xs },
    softLink: { marginTop: t.spacing.xl },
    breatheWrap: { marginTop: t.spacing.xl },
    continueWrap: { marginTop: t.spacing.md },
  })
