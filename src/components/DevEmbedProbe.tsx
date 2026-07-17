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
// A distinct belief that SHARES the "I am not…" frame + self-worth theme with the
// anchor — the hard case the original probe never tested. Under the frame-stripped
// geometry this scores ~0.709 against the anchor (below the 0.78 threshold, so it
// stays its own page); the calibrate() variants confirm the window opens only when
// the "I am [not]" frame is stripped before embedding.
const NEAR_DISTINCT = 'I am not worthy of a good partner'

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
      const nearDistinct = await LLMBridge.embed(`${PREFIX}${NEAR_DISTINCT}`)
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
      const nearDistinctCos = cosine(a1, nearDistinct)
      append('')
      append(`same-input cos(a1,a2)  ${selfSim.toFixed(3)}   ← must be ≈1.000; <0.999 = state leak between calls`)
      append(`synonym cos       ${synCos.toFixed(3)}   ← want ~0.77+  (should snap)`)
      append(`near-distinct cos ${nearDistinctCos.toFixed(3)}   ← "${NEAR_DISTINCT}"  (should NOT snap)`)
      append(`distinct cos      ${distinctCos.toFixed(3)}   ← want ~0.63`)
      append(`snap threshold is 0.78 — frame-stripped; near-distinct ABOVE it = over-snap`)
      append(`safe window: near-distinct < T ≤ synonym → T in (${nearDistinctCos.toFixed(3)}, ${synCos.toFixed(3)}]`)
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

  // The naive threshold no longer separates the hard case: on device, against
  // RAW text the near-distinct (0.848) outscores the real synonym (0.772), so no
  // cutoff separates them — an inverted window. Threshold tuning can't fix that;
  // the geometry has to change. snapBeliefSemantic strips the leading "I am
  // [not/never]" frame before embedding so the content word ("partner") dominates
  // over the shared skeleton, opening a window with the synonym 0.841 above the
  // near-distinct 0.709 and threshold 0.78 between them. This calibrate() runs
  // the geometry levers on the SAME three strings and prints whether each opens
  // a window (near-distinct < synonym):
  //   1. classification prefix — weights meaning over surface form vs the STS prefix
  //   2. frame-strip — drop the "I am [not/never]" self-ascription so the
  //      discriminating content word ("partner") dominates over the shared frame
  async function calibrate() {
    setBusy(true)
    setLog([])
    try {
      // Strip a leading first-person self-ascription frame so the content word
      // carries the signal. Two strengths:
      //   full    — drops subject AND polarity: "I am not good enough" → "good enough".
      //             Widest window, but a belief and its NEGATION collapse to the
      //             same text ("I am good enough" also → "good enough") — unsafe
      //             when positive reframes coexist with the negative belief.
      //   subject — drops only "I am/feel/'m", KEEPS not/never:
      //             "I am not good enough" → "not good enough". Preserves polarity;
      //             content words still separate distinct beliefs.
      const stripFull = (s: string) => s.replace(/^i\s+(?:am|feel|'m)\s+(?:not\s+|never\s+)?/i, '').trim()
      const stripSubject = (s: string) => s.replace(/^i\s+(?:am|feel|'m)\s+/i, '').trim()

      // Measure synonym / near-distinct / distinct cosines under a given prefix
      // and optional frame-strip, and report whether a window opens.
      async function variant(name: string, prefix: string, strip: ((s: string) => string) | null) {
        const t = (s: string) => `${prefix}${strip ? strip(s) : s}`
        const a = await LLMBridge.embed(t(ANCHOR))
        const syn = await LLMBridge.embed(t(SYNONYM))
        const near = await LLMBridge.embed(t(NEAR_DISTINCT))
        const dist = await LLMBridge.embed(t(DISTINCT))
        const synCos = cosine(a, syn)
        const nearCos = cosine(a, near)
        const distCos = cosine(a, dist)
        // A window exists if the real synonym outscores the frame-sharing
        // distinct belief — then a threshold in (near, syn] fixes the bug.
        const open = synCos > nearCos
        append('')
        append(`── ${name} ──`)
        if (strip) append(`   strip: "${strip(ANCHOR)}" / "${strip(SYNONYM)}" / "${strip(NEAR_DISTINCT)}"`)
        append(`   synonym       ${synCos.toFixed(3)}`)
        append(`   near-distinct ${nearCos.toFixed(3)}   ${open ? '' : '← still outscores synonym'}`)
        append(`   distinct      ${distCos.toFixed(3)}`)
        append(open ? `   ✓ window opens: T in (${nearCos.toFixed(3)}, ${synCos.toFixed(3)}]` : '   ✗ inverted — this lever does not separate them')
      }

      append('Testing geometry levers against the inverted window…')
      await variant('STS prefix, raw (baseline)', PREFIX, null)
      await variant('STS, subject-strip (keeps not/never)', PREFIX, stripSubject)
      await variant('STS, full-strip (drops polarity — unsafe)', PREFIX, stripFull)

      // Negation safety. The anchor's positive counter-belief must NOT snap to it —
      // a reframe ("I am good enough") is a different page from the belief it
      // counters ("I am not good enough"). full-strip collapses both to
      // "good enough" (cos≈1.000 → merges, BUG); subject-strip keeps "not" and
      // should stay well under threshold.
      const POSITIVE = 'I am good enough'
      async function negCheck(name: string, strip: (s: string) => string) {
        const a = await LLMBridge.embed(`${PREFIX}${strip(ANCHOR)}`)
        const pos = await LLMBridge.embed(`${PREFIX}${strip(POSITIVE)}`)
        const c = cosine(a, pos)
        append('')
        append(`── negation safety: ${name} ──`)
        append(`   strip: "${strip(ANCHOR)}" vs "${strip(POSITIVE)}"`)
        append(`   anchor↔positive ${c.toFixed(3)}   ${c >= 0.78 ? '← ✗ WOULD MERGE belief+reframe' : '✓ stays separate'}`)
      }
      await negCheck('subject-strip', stripSubject)
      await negCheck('full-strip', stripFull)
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

  // WS3 hybrid-ranker recalibration. The fusion constants in search.ts are the
  // bge-small-era values (BASELINE 0.3, WEIGHT 10) — EmbeddingGemma's cosine
  // distribution is higher/compressed, so an unrelated page at cosine ~0.6
  // clears the MIN_RELEVANCE 3 floor on semantics alone → over-grounding.
  // This embeds hand-authored query/page pairs at three relevance tiers (all
  // fixture strings — no user text) and prints the cosines, so the plateau and
  // the related band can be read off the log and the constants set from data.
  // Each pair uses the ranker's real prefixes: query → plain text, page →
  // "title\ncontent", both under the shared STS task prefix.
  async function ws3() {
    setBusy(true)
    setLog([])
    try {
      const EMBED = (s: string) => `${PREFIX}${s}`
      const pairs: { tier: string; query: string; page: string }[] = [
        // Unrelated: zero topical overlap — should sit on the plateau.
        { tier: 'unrelated', query: 'how do i bake sourdough', page: 'Job hunting\nSending applications and bracing for silence.' },
        { tier: 'unrelated', query: 'i want to learn the guitar', page: 'Sleep\nTossing the night before a deadline, foggy the next day.' },
        { tier: 'loose', query: 'i keep messing up at work', page: 'Sleep\nTossing the night before a deadline, foggy the next day.' },
        { tier: 'loose', query: 'work is exhausting lately', page: 'Job hunting\nSending applications and bracing for silence.' },
        // Clearly related: a reworded message vs its topical page.
        { tier: 'related', query: "i'm dreading the meeting at work tomorrow", page: 'Work anxiety\nYou tense up before meetings and replay them afterward, bracing for criticism.' },
        { tier: 'related', query: 'i cannot sleep before deadlines', page: 'Sleep\nTossing the night before a deadline, foggy the next day.' },
        { tier: 'related', query: 'nobody responds to my applications', page: 'Job hunting\nSending applications and bracing for silence.' },
      ]
      const byTier: Record<string, number[]> = {}
      for (const p of pairs) {
        const q = await LLMBridge.embed(EMBED(p.query))
        const v = await LLMBridge.embed(EMBED(p.page))
        const c = cosine(q, v)
        ;(byTier[p.tier] ??= []).push(c)
        append(`${p.tier.padEnd(9)} cos ${c.toFixed(3)}   q="${p.query}"`)
      }
      append('')
      const stat = (xs: number[]) =>
        xs.length ? `${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)} (n=${xs.length})` : '-'
      append(`unrelated range  ${stat(byTier.unrelated ?? [])}`)
      append(`loose range      ${stat(byTier.loose ?? [])}`)
      append(`related range    ${stat(byTier.related ?? [])}`)
      // Working hypothesis: SEMANTIC_BASELINE = unrelated-plateau (top of the
      // unrelated band); WEIGHT so that (related - BASELINE) × WEIGHT ≈ 3.
      const plateau = Math.max(...(byTier.unrelated ?? [0]))
      const relFloor = Math.min(...(byTier.related ?? [1]))
      const weight = relFloor > plateau ? (3 / (relFloor - plateau)).toFixed(1) : '?'
      append(`suggested BASELINE ${plateau.toFixed(2)}   WEIGHT ${weight}`)
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
        <Button title="Calibrate snap (fix over-snap)" variant="secondary" fullWidth onPress={() => void calibrate()} loading={busy} testID="dev-embed-probe-calib" />
        <Button title="Diagnose backfill (why 0/X?)" variant="secondary" fullWidth onPress={() => void diagnose()} loading={busy} testID="dev-embed-probe-diag" />
        <Button title="WS3 ranker probe" variant="secondary" fullWidth onPress={() => void ws3()} loading={busy} testID="dev-embed-probe-ws3" />
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
