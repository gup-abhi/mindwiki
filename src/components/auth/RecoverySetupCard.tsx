import { Modal, Pressable, StyleSheet, Text } from 'react-native'

import { useRecoverySetup } from '@/hooks/useRecoverySetup'

import { RecoveryPhraseView } from './RecoveryPhraseView'

/**
 * Home nudge for accounts with no recovery phrase yet (e.g. registered before
 * recovery existed). Tapping generates + uploads the escrow, then shows the
 * phrase once in a modal. Renders nothing once the account has recovery.
 */
export function RecoverySetupCard() {
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
    <Pressable
      accessibilityRole="button"
      style={styles.card}
      onPress={setup}
      disabled={busy}
      testID="recovery-setup-card"
    >
      <Text style={styles.title}>Protect your account</Text>
      <Text style={styles.sub}>
        {busy
          ? 'Setting up…'
          : (error ?? 'Set up a recovery phrase so you can get back in if you forget your password.')}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    backgroundColor: '#fdf3e7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: '#f0d9b8',
  },
  title: { fontSize: 15, color: '#8a5a1a', fontWeight: '700' },
  sub: { fontSize: 13, color: '#9a6a2a', marginTop: 4, lineHeight: 19 },
})
