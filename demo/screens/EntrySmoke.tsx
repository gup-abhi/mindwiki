import { useEffect, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { open, type DB } from '@op-engineering/op-sqlite'
import { randomUUID } from 'expo-crypto'

// Encrypted (SQLCipher) DB via op-sqlite. The file on disk is unreadable without
// this key. op-sqlite caches the connection by name, so we reuse one instance.
const DB_NAME = 'entries.db'
const DB_KEY = 'demo-test-key-32bytes-padding!!'

let dbRef: DB | null = null

async function getDb(): Promise<DB> {
  if (!dbRef) {
    dbRef = open({ name: DB_NAME, encryptionKey: DB_KEY })
    await dbRef.execute(
      'CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, content TEXT, created_at INTEGER)'
    )
  }
  return dbRef
}

interface Entry {
  id: string
  content: string
  created_at: number
}

export default function EntrySmoke() {
  const [text, setText] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [status, setStatus] = useState('')

  async function refresh() {
    const db = await getDb()
    const res = await db.execute(
      'SELECT id, content, created_at FROM entries ORDER BY created_at DESC'
    )
    setEntries(
      res.rows.map((r) => ({
        id: String(r.id),
        content: String(r.content),
        created_at: Number(r.created_at),
      }))
    )
  }

  useEffect(() => {
    refresh().catch((e) => setStatus(String(e)))
  }, [])

  async function save() {
    if (!text.trim()) return
    try {
      const db = await getDb()
      await db.execute('INSERT INTO entries (id, content, created_at) VALUES (?, ?, ?)', [
        randomUUID(),
        text.trim(),
        Date.now(),
      ])
      setText('')
      setStatus('Saved ✓')
      await refresh()
    } catch (e) {
      setStatus(String(e))
    }
  }

  async function clearAll() {
    try {
      const db = await getDb()
      await db.execute('DELETE FROM entries')
      setStatus('Cleared ✓')
      await refresh()
    } catch (e) {
      setStatus(String(e))
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Entry Smoke Test</Text>
      <Text style={styles.subtitle}>
        Write an entry, save it encrypted, and confirm it reads back from SQLite.
      </Text>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Type an entry…"
        multiline
      />

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveBtnText}>Save encrypted</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
          <Text style={styles.clearBtnText}>Clear all</Text>
        </TouchableOpacity>
      </View>

      {!!status && <Text style={styles.status}>{status}</Text>}

      <Text style={styles.count}>Entries in DB: {entries.length}</Text>

      {entries.map((e) => (
        <View key={e.id} style={styles.entry}>
          <Text style={styles.entryContent}>{e.content}</Text>
          <Text style={styles.entryMeta}>{new Date(e.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#555', marginBottom: 20, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  saveBtn: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  clearBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#f2f2f2',
  },
  clearBtnText: { color: '#d12f2f', fontSize: 16, fontWeight: '600' },
  status: { marginTop: 14, fontSize: 14, color: '#1b9e4b' },
  count: { marginTop: 20, fontSize: 16, fontWeight: '600' },
  entry: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 12,
  },
  entryContent: { fontSize: 15 },
  entryMeta: { fontSize: 12, color: '#999', marginTop: 4 },
})
