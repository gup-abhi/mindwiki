import { useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { open } from '@op-engineering/op-sqlite'
import * as Notifications from 'expo-notifications'
import argon2 from 'react-native-argon2'

import { CryptoModule } from '@/native/CryptoModuleStub'
import { LLMBridge } from '@/native/LLMBridge'

// react-native-argon2 default export is the hash function; alias to match the spec.
const Argon2 = { hash: argon2 }

interface CheckResult {
  name: string
  passed: boolean
  timingMs: number | null
  detail: string
}

const CHECKS: Array<() => Promise<CheckResult>> = [
  async function checkSQLCipher(): Promise<CheckResult> {
    const start = Date.now()
    const NAME = 'sqlcipher-check.db'
    const KEY = 'demo-test-key-32bytes-padding!!'
    try {
      // 1. Open with the real key, write and read back.
      const db = open({ name: NAME, encryptionKey: KEY })
      await db.execute('DROP TABLE IF EXISTS test')
      await db.execute('CREATE TABLE test (id TEXT, val TEXT)')
      await db.execute('INSERT INTO test VALUES (?, ?)', ['1', 'hello-mindwiki'])
      const res = await db.execute('SELECT val FROM test WHERE id = ?', ['1'])
      const readBack = res.rows[0]?.val
      db.close()

      // 2. Reopen the SAME file with a WRONG key. With real SQLCipher the first
      //    read must fail to decrypt; if it succeeds, the file isn't encrypted.
      let wrongKeyRejected = false
      const wrongDb = open({ name: NAME, encryptionKey: 'totally-wrong-key' })
      try {
        await wrongDb.execute('SELECT val FROM test WHERE id = ?', ['1'])
      } catch {
        wrongKeyRejected = true
      }
      wrongDb.close()

      const passed = readBack === 'hello-mindwiki' && wrongKeyRejected
      const detail =
        readBack !== 'hello-mindwiki'
          ? `Read failed: ${String(readBack)}`
          : wrongKeyRejected
            ? 'Encrypted write/read OK · wrong key rejected ✓'
            : '⚠️ WRONG KEY ACCEPTED — file is NOT encrypted'
      return { name: 'SQLite + SQLCipher', passed, timingMs: Date.now() - start, detail }
    } catch (e) {
      return {
        name: 'SQLite + SQLCipher',
        passed: false,
        timingMs: Date.now() - start,
        detail: String(e),
      }
    }
  },

  async function checkArgon2(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const salt = 'mindwiki-demo-salt' // fixed for determinism check
      const result = await Argon2.hash('testpassword', salt, {
        iterations: 3,
        memory: 65536, // 64MB — same as production settings
        parallelism: 4,
        hashLength: 32,
        mode: 'argon2id',
      })
      const timing = Date.now() - start
      const passed = typeof result.rawHash === 'string' && result.rawHash.length > 0
      const detail = passed
        ? `Key derived in ${timing}ms${timing > 4000 ? ' — consider lower memory for UX' : ''}`
        : 'Hash output was empty'
      return { name: 'Argon2id key derivation', passed, timingMs: timing, detail }
    } catch (e) {
      return {
        name: 'Argon2id key derivation',
        passed: false,
        timingMs: Date.now() - start,
        detail: String(e),
      }
    }
  },

  async function checkAESGCM(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const testKey = 'a'.repeat(64) // 32 bytes in hex
      const plaintext = 'Hello MindWiki - AES test'
      const encrypted = await CryptoModule.encrypt(plaintext, testKey)
      const decrypted = await CryptoModule.decrypt(encrypted, testKey)
      const passed = decrypted === plaintext
      return {
        name: 'AES-256-GCM',
        passed,
        timingMs: Date.now() - start,
        detail: passed ? 'Encrypt/decrypt verified (STUB)' : `Got: ${decrypted}`,
      }
    } catch (e) {
      return {
        name: 'AES-256-GCM',
        passed: false,
        timingMs: Date.now() - start,
        detail: String(e),
      }
    }
  },

  async function checkFastModel(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const loadStart = Date.now()
      await LLMBridge.loadModel('fast')
      const loadTime = Date.now() - loadStart

      const inferStart = Date.now()
      const output = await LLMBridge.tag(
        'Output only valid JSON with one field: {"emotion": "anxiety"}',
        { maxTokens: 50, temperature: 0.1 }
      )
      const inferTime = Date.now() - inferStart

      // Extract the JSON object from the output (model may wrap it in prose/fences).
      const open = output.text.indexOf('{')
      const close = output.text.lastIndexOf('}')
      const parsed = open >= 0 && close > open ? JSON.parse(output.text.slice(open, close + 1)) : null
      const passed = parsed != null && typeof parsed.emotion === 'string'

      return {
        name: 'Fast model (1.5B)',
        passed,
        timingMs: Date.now() - start,
        detail: `Load: ${loadTime}ms · Infer: ${inferTime}ms · ${output.tokensPredicted} tok · ~${Math.round(output.tokensPerSec)} tok/s`,
      }
    } catch (e) {
      return {
        name: 'Fast model (1.5B)',
        passed: false,
        timingMs: Date.now() - start,
        detail: String(e),
      }
    }
  },

  async function checkDeepModel(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const loadStart = Date.now()
      await LLMBridge.loadModel('deep')
      const loadTime = Date.now() - loadStart

      const inferStart = Date.now()
      const output = await LLMBridge.synthesise('Write one sentence about journaling.', {
        maxTokens: 60,
        temperature: 0.7,
      })
      const inferTime = Date.now() - inferStart

      const passed = output.text.trim().length > 10

      return {
        name: 'Deep model (3B)',
        passed,
        timingMs: Date.now() - start,
        detail: `Load: ${loadTime}ms · Infer: ${inferTime}ms · ${output.tokensPredicted} tok · ~${Math.round(output.tokensPerSec)} tok/s`,
      }
    } catch (e) {
      return {
        name: 'Deep model (3B)',
        passed: false,
        timingMs: Date.now() - start,
        detail: String(e),
      }
    }
  },

  async function checkNotifications(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const { status } = await Notifications.requestPermissionsAsync()
      if (status !== 'granted') {
        return {
          name: 'Notifications',
          passed: false,
          timingMs: Date.now() - start,
          detail: 'Permission denied',
        }
      }
      await Notifications.scheduleNotificationAsync({
        content: { title: 'MindWiki demo', body: 'Notifications work ✓' },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 3,
        },
      })
      return {
        name: 'Notifications',
        passed: true,
        timingMs: Date.now() - start,
        detail: 'Permission granted, test fires in 3s',
      }
    } catch (e) {
      return {
        name: 'Notifications',
        passed: false,
        timingMs: Date.now() - start,
        detail: String(e),
      }
    }
  },
]

export default function SystemCheck() {
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [running, setRunning] = useState(false)

  async function runOne(check: () => Promise<CheckResult>) {
    const result = await check()
    setResults((prev) => ({ ...prev, [result.name]: result }))
  }

  async function runAll() {
    setRunning(true)
    setResults({})
    for (const check of CHECKS) {
      await runOne(check)
    }
    setRunning(false)
  }

  const completed = Object.values(results)
  const passedCount = completed.filter((r) => r.passed).length

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>System Check</Text>
      <Text style={styles.subtitle}>
        Validates the highest-risk dependencies. Items marked STUB validate the harness
        only — swap in real native modules before signing off the gate.
      </Text>

      <TouchableOpacity
        style={[styles.runAll, running && styles.disabled]}
        onPress={runAll}
        disabled={running}
      >
        <Text style={styles.runAllText}>{running ? 'Running…' : 'Run all'}</Text>
      </TouchableOpacity>

      {completed.length > 0 && (
        <Text style={styles.summary}>
          {passedCount}/{CHECKS.length} passed
        </Text>
      )}

      {CHECKS.map((check, i) => (
        <CheckRow
          key={i}
          index={i}
          result={results[CHECK_NAMES[i]] ?? null}
          onRun={() => runOne(check)}
        />
      ))}
    </ScrollView>
  )
}

// Row labels, in the same order as CHECKS.
const CHECK_NAMES = [
  'SQLite + SQLCipher',
  'Argon2id key derivation',
  'AES-256-GCM',
  'Fast model (1.5B)',
  'Deep model (3B)',
  'Notifications',
]

function CheckRow({
  index,
  result,
  onRun,
}: {
  index: number
  result: CheckResult | null
  onRun: () => void
}) {
  const label = CHECK_NAMES[index]
  const badge = result ? (result.passed ? '✓' : '✗') : '—'
  const badgeStyle = result
    ? result.passed
      ? styles.badgePass
      : styles.badgeFail
    : styles.badgeIdle

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={[styles.badge, badgeStyle]}>{badge}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
        <TouchableOpacity style={styles.runBtn} onPress={onRun}>
          <Text style={styles.runBtnText}>Run</Text>
        </TouchableOpacity>
      </View>
      {result && (
        <Text style={styles.detail}>
          {result.detail}
          {result.timingMs != null ? ` · ${result.timingMs}ms` : ''}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#555', marginBottom: 20, lineHeight: 20 },
  runAll: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  runAllText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  summary: { textAlign: 'center', marginVertical: 14, fontSize: 16, fontWeight: '600' },
  row: { borderTopWidth: 1, borderTopColor: '#eee', paddingVertical: 14 },
  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  badge: { width: 28, fontSize: 18, fontWeight: '700' },
  badgePass: { color: '#1b9e4b' },
  badgeFail: { color: '#d12f2f' },
  badgeIdle: { color: '#bbb' },
  rowLabel: { flex: 1, fontSize: 16 },
  runBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#eef',
    borderRadius: 8,
  },
  runBtnText: { color: '#1a1a2e', fontWeight: '600' },
  detail: { marginTop: 6, marginLeft: 28, fontSize: 13, color: '#666' },
})
