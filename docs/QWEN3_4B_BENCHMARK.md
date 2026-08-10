# Qwen3-4B-Instruct-2507 deep-model benchmark

This is a developer-only, local A/B benchmark of the current Qwen2.5-3B deep model against Qwen3-4B-Instruct-2507. It answers whether Qwen3 is better on MindWiki’s **existing** workloads before considering a production swap or any factual-memory work.

## Scope

The benchmark runs synthetic fixtures for:

- current entry extraction (emotion, distortion, topics, entities, beliefs, and behaviors);
- wiki synthesis house style;
- Reflect reply house style and safety.

It does not read or write journal data, wiki pages, graph records, storage, sync, retrieval, Reflect conversations, or factual memory. Results are aggregate counters and timings only.

## Candidate artifact

| Model | App filename | Purpose |
|---|---|---|
| Current Qwen2.5-3B Q4_K_M | `deep-model.gguf` | Baseline; unchanged production artifact |
| Qwen3-4B-Instruct-2507 Q4_K_M | `qwen3-4b-instruct-2507-benchmark.gguf` | Developer-only candidate |

Download the Qwen3 GGUF from the selected pinned release on the host. Before copying it to a device, record the release revision, file size, and SHA-256 in the device-run notes:

```bash
sha256sum Qwen3-4B-Instruct-2507-Q4_K_M.gguf
```

Never rename it to `deep-model.gguf` and never replace the current production file.

The benchmark uses the app document-directory model folder. Use the same app-private transfer method used for development builds, but preserve the dedicated candidate filename. The benchmark panel rejects files outside its expected Q4 size range; host SHA-256 is the authoritative integrity check.

## Runtime profile

Both models use exactly:

```text
CPU only
n_ctx = 2048
n_threads = 6
n_threads_batch = llama.rn default for this installed API
```

Do not enable OpenCL, Hexagon, GPU, or NPU acceleration. The target-device accelerator path has previously failed initialization and is not part of this comparison.

Models are never benchmarked concurrently. The primary procedure uses one model per fresh app process. The benchmark bridge releases its temporary context after each run, but release is a cleanup boundary—not proof that in-process A/B memory is equivalent to a cold app process.

## Device procedure

1. Build and install a development Android build.
2. Confirm normal MindWiki behavior with `deep-model.gguf` unchanged.
3. Force-stop the app, relaunch it, and run **current Qwen2.5 3B** from Settings → Developer → Deep-model A/B benchmark.
4. Record the panel’s aggregate report only.
5. Force-stop and relaunch again. Run **Qwen3 4B candidate** with identical device state as closely as practical.
6. Repeat each model with its 20-job soak control.
7. Before model load, after load, and after soak, capture host-side observations:

```bash
adb shell dumpsys meminfo <app-package>
adb shell dumpsys thermalservice
```

Use Perfetto or Android Studio Energy Profiler for energy measurements where available. Do not add unverified native telemetry merely for this benchmark.

## Decision rule

Keep Qwen2.5-3B unless Qwen3:

- loads and completes reliably with no crash, ANR, watchdog failure, or thinking-block leakage;
- matches or improves extraction fixture exactness;
- matches or improves wiki/Reflect style pass rates without new scaffolding, clinical, or deflection violations;
- has no material regression in p95 workload time, throughput over the soak, observed memory stability, or thermal behavior; and
- leaves normal production model loading and journaling unchanged.

A candidate win authorizes only a separate proposal to evaluate a production deep-model swap. It does not authorize factual-memory work, persistence, or changes to the normal model download/onboarding flow.
