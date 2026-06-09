import { Modal, StyleSheet } from 'react-native'

import { Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'

import { RecoveryPhraseView } from './RecoveryPhraseView'

/**
 * Home nudge for accounts with no recovery phrase yet (e.g. registered before
 * recovery existed). Tapping generates + uploads the escrow, then shows the
 * phrase once in a modal. Renders nothing once the account has recovery.
 */
export function RecoverySetupCard() {
  const styles = useThemedStyles(makeStyles)
  const { needsSetup, phrase, busy, error, setup, done } = useRecoverySetup()

  if (phrase) {
    return (
      <Modal visible animationType="slide" onRequestClose={done}>
        <RecoveryPhraseView phrase={phrase} onConfirm={done} />
      </Modal>
    )
  }

  if (!needsSetup) return null

  return (
    <Card
      variant="accent"
      style={styles.card}
      onPress={busy ? undefined : setup}
      testID="recovery-setup-card"
    >
      <Text variant="label" color="accentText">
        Protect your account
      </Text>
      <Text variant="caption" color="accentText" style={styles.sub}>
        {busy
          ? 'Setting up…'
          : (error ?? 'Set up a recovery phrase so you can get back in if you forget your password.')}
      </Text>
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { marginTop: t.spacing.lg, alignSelf: 'stretch' },
    sub: { marginTop: t.spacing.xs },
  })
