import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { LLMBridge } from '@/native/LLMBridge'
import { cosine } from '@/services/wiki/search'
import { listPages } from '@/services/storage/wiki'
import { listPageEmbeddings } from '@/services/storage/page-embeddings'
import { listEntityEmbeddings } from '@/services/storage/entity-embeddings'

const PREFIX = 'task: sentence similarity | query: '
const ANCHOR = 'I am not good enough'
const SYNONYM = 'I am never enough'
const DISTINCT = 'People will abandon me'

/** L2 norm of a vector. */
function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0))
}

/**
 * Dev-only: prove the on-device embed model actually works after the
 * EmbeddingGemma swap. Reflect responses are NOT proof — the ranker falls back
 * to lexical matching when embeddings are broken, so pages still surface. This
 * embeds real strings and shows the three numbers that settle it:
 *   • dim   → 768 = EmbeddingGemma live, 384 = old bge/MiniLM, 0 = broken
 *   • norm  → nonzero = real vector, 0 = the all-zero defect
 *   • cosine → two synonyms should score high (~0.77+), a distinct belief low
 *     (~0.63); a clear gap confirms separation matches the off-device probe.
 * Only rendered under __DEV__.
 */
export function DevEmbedProbe() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  function append(msg: string) {
    setLog((prev) => [...prev, msg])
  }

  async function run() {
    setBusy(true)
    setLog([])
    try {
      // State-leak probe. A BERT-style encoder is stateless: embedding the same
      // string must return the same vector regardless of what came before it.
      // If llama.rn's ctx.embedding() doesn't clear the KV cache between calls,
      // the two ANCHOR embeddings diverge because the intervening strings leak
      // into the second one. Sequential (the lock serializes anyway), no concurrency.
      append('Embedding ANCHOR, then SYNONYM, then DISTINCT, then ANCHOR again…')
      const t0 = performance.now()
      const a1 = await LLMBridge.embed(`${PREFIX}${ANCHOR}`)
      const t1 = performance.now()
      const syn = await LLMBridge.embed(`${PREFIX}${SYNONYM}`)
      const t2 = performance.now()
      const distinct = await LLMBridge.embed(`${PREFIX}${DISTINCT}`)
      const t3 = performance.now()
      const a2 = await LLMBridge.embed(`${PREFIX}${ANCHOR}`)
      const t4 = performance.now()
      if (!Array.isArray(a1) || a1.length === 0) {
        append('✗ embed failed — model not loaded or returned nothing.')
        return
      }
      append(`dim ${a1.length}  (768 = live, 384 = old, 0 = broken)`)
      append(`norm ${norm(a1).toFixed(3)}  (0 = all-zero defect)`)
      append('')
      // Per-embed wall-clock — drives the backfill cost estimate: total ≈ N × avg.
      // First embed pays context load; subsequent are warm-load only.
      const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`
      append(`timing  cold  ${fmt(t1 - t0)}   warm  ${fmt(t2 - t1)}   ${fmt(t3 - t2)}   ${fmt(t4 - t3)}`)
      const warmAvg = (t2 - t1 + t3 - t2 + t4 - t3) / 3
      // Rough backfill cost for common page counts — wall-clock is the
      // sum, but reflects sequential embed-and-store time. Round to seconds.
      const fmtTotal = (n: number) => `${Math.round(warmAvg * n)}s`
      append(`        warm avg ${fmt(warmAvg)}    backfill ≈ 50→${fmtTotal(50)}   200→${fmtTotal(200)}   500→${fmtTotal(500)}`)

      const selfSim = cosine(a1, a2)
      const synCos = cosine(a1, syn)
      const distinctCos = cosine(a1, distinct)
      append('')
      append(`same-input cos(a1,a2)  ${selfSim.toFixed(3)}   ← must be ≈1.000; <0.999 = state leak between calls`)
      append(`synonym cos  ${synCos.toFixed(3)}   ← want ~0.77+`)
      append(`distinct cos ${distinctCos.toFixed(3)}   ← want ~0.63`)
      append(`gap ${(synCos - distinctCos).toFixed(3)}   ← want clearly positive`)
      if (selfSim > 0.999 && synCos - distinctCos > 0.05) {
        append('✓ deterministic + separates: embeddings usable')
      } else if (selfSim <= 0.999) {
        append('✗ STATE LEAK — same input gives different vectors across calls')
      } else {
        append('✗ deterministic but no separation — wrong geometry')
      }
    } finally {
      setBusy(false)
    }
  }

  async function diagnose() {
    setBusy(true)
    setLog([])
    try {
      // What's actually in the cache tables? Why did backfill report 0/36?
      const stored = await listPageEmbeddings()
      const pages = await listPages()
      const beliefStored = await listEntityEmbeddings('belief')

      if (stored.success) {
        append(`page_embeddings rows: ${stored.data.size}`)
        for (const [id, emb] of stored.data) {
          append(`  ${id}  dim=${emb.vector.length}  hash=${emb.contentHash.slice(0, 8)}`)
        }
      } else {
        append('✗ listPageEmbeddings failed')
      }
      if (pages.success) {
        append(`wiki pages: ${pages.data.length}`)
        // Try embedding page 0 directly to see if a real page fails.
        if (pages.data.length > 0) {
          const p = pages.data[0]
          const text = `${p.title}\n${p.content.slice(0, 1500)}`.length
          append(`page 0: title="${p.title}"  text_len=${text}  id=${p.id.slice(0, 8)}…`)
          const t0 = performance.now()
          const v = await LLMBridge.embed(`task: sentence similarity | query: ${p.title}\n${p.content.slice(0, 1500)}`)
          const t1 = performance.now()
          append(`  embed → dim=${v.length}  ${(t1 - t0).toFixed(0)}ms`)
        }
      } else {
        append('✗ listPages failed')
      }
      if (beliefStored.success) {
        append(`entity_embeddings belief rows: ${beliefStored.data.size}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">
        Prove the embed model works. Reflect grounding isn&apos;t proof — it
        falls back to lexical when embeddings are broken. This embeds real
        strings and shows dim / norm / synonym separation.
      </Text>
      <View style={styles.btns}>
        <Button title="Probe embeddings" fullWidth onPress={() => void run()} loading={busy} testID="dev-embed-probe-run" />
        <Button title="Diagnose backfill (why 0/X?)" variant="secondary" fullWidth onPress={() => void diagnose()} loading={busy} testID="dev-embed-probe-diag" />
      </View>
      {log.length > 0 && (
        <View style={styles.log}>
          {log.map((line, i) => (
            <Text key={i} variant="caption" color={logColor(line)}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}

/** Colour a log line by its status prefix. */
function logColor(line: string): 'success' | 'danger' | 'textMuted' {
  if (line.startsWith('✓')) return 'success'
  if (line.startsWith('✗')) return 'danger'
  return 'textMuted'
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    btns: { marginTop: t.spacing.md, gap: t.spacing.sm },
    log: { marginTop: t.spacing.md, gap: t.spacing.xs },
  })
