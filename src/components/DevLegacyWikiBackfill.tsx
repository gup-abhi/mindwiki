import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { backfillLegacyWikiPages } from '@/services/wiki/legacy-backfill'
import { useSyncStore } from '@/store/sync.store'

/** Dev-only manual repair for wiki pages with an empty retained version 1. */
export function DevLegacyWikiBackfill() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  async function run() {
    setBusy(true)
    setLog([])
    try {
      const result = await backfillLegacyWikiPages(undefined, true)
      if (!result.success) {
        setLog(['Backfill failed.'])
        return
      }
      setLog([result.data === 0 ? 'No legacy empty-v1 pages found.' : `Repaired ${result.data} page(s).`])
      useSyncStore.getState().bumpRevision()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Remove legacy empty version 1 shells and renumber retained wiki history. No content is regenerated.
      </Text>
      <View style={styles.btns}>
        <Button
          title="Backfill legacy wiki versions"
          variant="secondary"
          fullWidth
          onPress={() => void run()}
          loading={busy}
          testID="dev-legacy-wiki-backfill-run"
        />
      </View>
      {log.map((line) => (
        <Text key={line} variant="caption" color={line.startsWith('Backfill') ? 'danger' : 'success'} style={styles.log}>
          {line}
        </Text>
      ))}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    btns: { marginTop: t.spacing.md, gap: t.spacing.sm },
    log: { marginTop: t.spacing.md },
  })