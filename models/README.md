# Model files

Not committed to git (900MB–4GB each).

**In the app:** models download on demand — the Home "Download AI models" card
(shown when they're missing) fetches both into the app's document directory
(`${documentDirectory}models/`, see `src/services/llm/model-manager.ts`), the
same location `LLMBridge` loads from. It checks before downloading, so it never
re-fetches an existing file. No `adb push` needed on a real install (e.g. a
QR-paired device). The manual steps below are for the Phase -1 demo / local dev.

```bash
pip install huggingface_hub

# Fast model (Qwen2.5 1.5B Q4_K_M, ~900MB)
huggingface-cli download Qwen/Qwen2.5-1.5B-Instruct-GGUF \
  qwen2.5-1.5b-instruct-q4_k_m.gguf --local-dir ./models
mv models/qwen2.5-1.5b-instruct-q4_k_m.gguf models/fast-model.gguf

# Deep model (Qwen2.5 3B Q4_K_M, ~1.8GB)
huggingface-cli download Qwen/Qwen2.5-3B-Instruct-GGUF \
  qwen2.5-3b-instruct-q4_k_m.gguf --local-dir ./models
mv models/qwen2.5-3b-instruct-q4_k_m.gguf models/deep-model.gguf

# Embed model (bge-small-en-v1.5 F16, ~67MB) — optional; powers semantic Reflect
# retrieval. A missing embed model just falls back to lexical ranking.
huggingface-cli download CompendiumLabs/bge-small-en-v1.5-gguf \
  bge-small-en-v1.5-f16.gguf --local-dir ./models
mv models/bge-small-en-v1.5-f16.gguf models/embed-model.gguf
```

## Push to device (Phase -1 demo, Android)

The demo loads GGUF via llama.rn from the app's external files dir. After building +
installing the demo app once (so the dir exists), push the models with `adb`:

```bash
adb shell mkdir -p /storage/emulated/0/Android/data/com.mindwiki.demo/files
adb push models/fast-model.gguf /storage/emulated/0/Android/data/com.mindwiki.demo/files/
adb push models/deep-model.gguf /storage/emulated/0/Android/data/com.mindwiki.demo/files/
```

These paths are hardcoded in `demo/native/LLMBridge.ts`. If a model is missing, the
Fast/Deep model check fails with a "did you adb push it?" message.

## Developer-only Qwen3 4B comparison

The Qwen3-4B-Instruct-2507 candidate must remain a separately named benchmark
artifact. Never overwrite `deep-model.gguf` or add it to normal model downloads.
See [`docs/QWEN3_4B_BENCHMARK.md`](../docs/QWEN3_4B_BENCHMARK.md) for the pinned-artifact,
checksum, sideload, and physical-device A/B procedure.

