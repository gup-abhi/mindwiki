import { Modal, StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

interface Props {
  visible: boolean
  /** The streak length that using the freeze(s) would preserve. */
  streakLength: number
  /** How many freezes it costs (one per missed day). */
  freezesNeeded: number
  onUse: () => void
  onDismiss: () => void
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`

/**
 * Popup shown on opening the app when a missed day has put the streak at risk and
 * the user holds enough freezes to save it. Spending is the user's choice — they
 * can let the streak break instead and keep their freezes for later.
 */
export function StreakRescueModal({ visible, streakLength, freezesNeeded, onUse, onDismiss }: Props) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Card style={styles.card} testID="streak-rescue">
          <Text variant="display" style={styles.flake}>
            ❄
          </Text>
          <Text variant="subtitle" style={styles.title}>
            Your {streakLength}-day streak is at risk
          </Text>
          <Text variant="body" color="textSecondary" style={styles.body}>
            You missed {plural(freezesNeeded, 'day')}. Use {plural(freezesNeeded, 'freeze')} to keep
            your streak alive?
          </Text>
          <View style={styles.actions}>
            <Button title={`Use ${plural(freezesNeeded, 'freeze')}`} onPress={onUse} testID="rescue-use" />
            <Button title="Not now" variant="ghost" onPress={onDismiss} testID="rescue-dismiss" />
          </View>
        </Card>
      </View>
    </Modal>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: t.spacing.xl,
    },
    card: { alignSelf: 'stretch', alignItems: 'center', padding: t.spacing.xl },
    flake: { marginBottom: t.spacing.sm },
    title: { textAlign: 'center' },
    body: { textAlign: 'center', marginTop: t.spacing.sm, lineHeight: 22 },
    actions: { alignSelf: 'stretch', marginTop: t.spacing.xl, gap: t.spacing.sm },
  })
