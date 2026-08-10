import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { ModelBenchmarkBridge } from '@/native/ModelBenchmarkBridge'
import { BENCHMARK_MODELS, isBenchmarkModelPresent, type BenchmarkModelId } from '@/services/llm/dev/benchmark-models'
import { runModelBenchmark, type ModelBenchmarkReport } from '@/services/llm/dev/model-benchmark'
import { type Theme, useThemedStyles } from '@/theme'

function formatMs(value: number): string {
  return `${Math.round(value)}ms`
}

function formatRate(value: number): string {
  return `${value.toFixed(1)} tok/s`
}

function reportLines(report: ModelBenchmarkReport): string[] {
  return [
    `${BENCHMARK_MODELS[report.modelId].label}`,
    `Load ${formatMs(report.loadMs)} · p50 ${formatMs(report.p50Ms)} · p95 ${formatMs(report.p95Ms)} · worst ${formatMs(report.worstMs)}`,
    `Completed ${report.completed} · failures ${report.failures} · mean ${formatRate(report.meanTokensPerSec)}`,
    `Extract valid ${report.extractionValid} · exact ${report.extractionExact} · wiki style ${report.wikiStylePasses} · Reflect style ${report.reflectStylePasses}`,
    `Thinking leaks ${report.thinkLeakCount} · context released ${report.released ? 'yes' : 'no'}`,
  ]
}

/**
 * Dev-only local A/B report. It never reads journal/wiki data: the service owns
 * synthetic fixtures and this panel renders only aggregate counters/timings.
 */
export function DevModelBenchmark() {
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [availability, setAvailability] = useState<Record<BenchmarkModelId, boolean>>({
    qwen2_5_3b: false,
    qwen3_4b: false,
  })
  const [report, setReport] = useState<ModelBenchmarkReport | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => () => {
    void ModelBenchmarkBridge.releaseModel()
  }, [])

  async function refresh() {
    setBusy(true)
    setMessage('')
    try {
      const [baseline, candidate] = await Promise.all([
        isBenchmarkModelPresent('qwen2_5_3b'),
        isBenchmarkModelPresent('qwen3_4b'),
      ])
      setAvailability({ qwen2_5_3b: baseline, qwen3_4b: candidate })
    } catch {
      setMessage('Model availability check failed')
    } finally {
      setBusy(false)
    }
  }

  async function run(modelId: BenchmarkModelId, soakRuns = 0) {
    setBusy(true)
    setMessage('')
    setReport(null)
    try {
      if (!await isBenchmarkModelPresent(modelId)) {
        setMessage('Selected benchmark model is missing or has an unexpected size')
        return
      }
      setReport(await runModelBenchmark(modelId, { soakRuns }))
    } catch {
      setMessage('Benchmark run failed')
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    setBusy(true)
    setMessage('')
    try {
      await ModelBenchmarkBridge.releaseModel()
      setMessage('Benchmark context released')
    } catch {
      setMessage('Benchmark context release failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="sunken">
      <Text variant="bodyStrong">Deep-model A/B benchmark</Text>
      <Text variant="caption" color="textSecondary" style={styles.line}>
        Synthetic local jobs only. Shows aggregate quality and timing; no journal, wiki, prompt, or model-output text.
      </Text>
      <View style={styles.buttons}>
        <Button title="Check benchmark models" variant="secondary" fullWidth onPress={() => void refresh()} loading={busy} testID="dev-model-benchmark-refresh" />
        <Button title="Run current Qwen2.5 3B" fullWidth onPress={() => void run('qwen2_5_3b')} loading={busy} testID="dev-model-benchmark-baseline" />
        <Button title="Run Qwen3 4B candidate" fullWidth onPress={() => void run('qwen3_4b')} loading={busy} testID="dev-model-benchmark-candidate" />
        <Button title="Run Qwen3 4B 20-job soak" variant="secondary" fullWidth onPress={() => void run('qwen3_4b', 20)} loading={busy} testID="dev-model-benchmark-soak" />
        <Button title="Release benchmark model" variant="secondary" fullWidth onPress={() => void release()} loading={busy} testID="dev-model-benchmark-release" />
      </View>
      <View style={styles.readout}>
        <Text variant="caption" color="textSecondary">
          Current model {availability.qwen2_5_3b ? 'ready' : 'missing'} · Qwen3 candidate {availability.qwen3_4b ? 'ready' : 'missing'}
        </Text>
        {report && reportLines(report).map((line) => (
          <Text key={line} variant="caption" color="textSecondary">{line}</Text>
        ))}
      </View>
      {!!message && <Text variant="caption" color="textSecondary" style={styles.line}>{message}</Text>}
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    buttons: { marginTop: t.spacing.md, gap: t.spacing.sm },
    readout: { marginTop: t.spacing.md, gap: t.spacing.xs },
    line: { marginTop: t.spacing.xs },
  })
