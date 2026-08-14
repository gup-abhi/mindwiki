---
name: native-debug
description: Diagnose MindWiki React Native, Expo, Android, iOS, SQLCipher, SecureStore, or llama.rn failures while preserving device-proven constraints.
argument-hint: "android|ios|model|storage [symptom]"
---

# Native debugging

1. State the symptom, target device/build, and success signal.
2. Read relevant project memories and existing native config before changing code. Preserve these known constraints:
   - llama models stay CPU-only; do not re-enable OpenCL/Hexagon offload;
   - do not merge the entry flow back into a scrolling screen;
   - Android Fabric press handling has project-specific stationary-touch fallbacks;
   - avoid `forwardRef` imperative handles where the RN renderer previously crashed.
3. Start with non-destructive checks:
   - Android: `adb devices`, focused logs, package state, then `yarn android` if rebuild is needed.
   - iOS: simulator/device status, pods only when native dependencies changed, then `yarn ios`.
   - Models: verify file presence/size and model role without reading or committing weights.
4. Warn before `yarn prebuild`: it runs `expo prebuild --clean` and regenerates native projects.
5. Distinguish JS-only, native rebuild, and physical-device-only verification. Jest mocks are not proof of SQLCipher, Keychain/Keystore, Argon2, notifications, camera, or llama.rn behavior.
6. Reproduce first, write a focused test where feasible, make the smallest fix, then repeat the exact reproduction and device gate.
7. Never log journal text, wiki content, keys, tokens, or recovery phrases.
