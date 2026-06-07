import { useRouter } from 'expo-router'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { RecoveryPhraseView } from '@/components/auth/RecoveryPhraseView'
import { useAuth } from '@/hooks/useAuth'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'
import { useSyncStatus } from '@/hooks/useSyncStatus'

function timeAgo(ms: number | null): string {
  if (!ms) return 'Never'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function Settings() {
  const router = useRouter()
  const { lastPull, pending, syncing, syncNow } = useSyncStatus()
  const { needsSetup, phrase, busy, error, setup, done } = useRecoverySetup()
  const { logout } = useAuth()

  return (
    <View style={styles.container}>
      {phrase && (
        <Modal visible animationType="slide" onRequestClose={done}>
          <RecoveryPhraseView phrase={phrase} onConfirm={done} />
        </Modal>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        <Pressable onPress={() => router.back()} testID="settings-back">
          <Text style={styles.back}>‹ Home</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>

        <Text style={styles.section}>Sync</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Last synced</Text>
            <Text style={styles.value}>{timeAgo(lastPull)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Waiting to upload</Text>
            <Text style={styles.value}>{pending === 0 ? 'All synced' : `${pending}`}</Text>
          </View>
          <Pressable
            style={[styles.button, syncing && styles.buttonDisabled]}
            disabled={syncing}
            onPress={() => syncNow()}
            testID="settings-sync-now"
          >
            {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sync now</Text>}
          </Pressable>
        </View>

        <Text style={styles.section}>Recovery phrase</Text>
        <View style={styles.card}>
          {needsSetup ? (
            <>
              <Text style={styles.hint}>
                Set up a recovery phrase so you can get back in if you forget your password.
              </Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                style={[styles.button, busy && styles.buttonDisabled]}
                disabled={busy}
                onPress={() => setup()}
                testID="settings-setup-recovery"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Set up recovery phrase</Text>
                )}
              </Pressable>
            </>
          ) : (
            <Text style={styles.value}>✓ Recovery phrase is set up</Text>
          )}
        </View>

        <Text style={styles.section}>Account</Text>
        <Pressable style={styles.logout} onPress={() => logout()} testID="settings-logout">
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 24, paddingTop: 64 },
  back: { fontSize: 16, color: '#7a7ad0', fontWeight: '600' },
  title: { fontSize: 30, fontWeight: '700', color: '#1a1a2e', marginTop: 8 },
  section: { fontSize: 13, color: '#9a9ab8', fontWeight: '700', textTransform: 'uppercase', marginTop: 28, marginBottom: 8 },
  card: { backgroundColor: '#f4f4fb', borderRadius: 14, padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  label: { fontSize: 15, color: '#666' },
  value: { fontSize: 15, color: '#1a1a2e', fontWeight: '600' },
  hint: { fontSize: 14, color: '#666', lineHeight: 20 },
  error: { color: '#d12f2f', fontSize: 13, marginTop: 8 },
  button: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  buttonDisabled: { backgroundColor: '#b9b9cc' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  logout: { paddingVertical: 14, alignItems: 'center' },
  logoutText: { color: '#d12f2f', fontSize: 16, fontWeight: '700' },
})
