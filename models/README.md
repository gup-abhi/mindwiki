# Model files

Not committed to git (900MB–4GB each). Download before running Phase -1 demo.

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

