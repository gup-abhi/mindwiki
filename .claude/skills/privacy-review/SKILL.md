---
name: privacy-review
description: Audit a MindWiki diff or subsystem against its zero-knowledge privacy, auth, recovery, encryption, and mental-health safety boundaries.
argument-hint: "[diff|path|feature]"
---

# MindWiki privacy review

Review only; do not apply fixes unless requested.

1. Read `docs/PRIVACY_SECURITY.md`, `docs/AUTH_DB_LIFECYCLE.md`, and the relevant source/tests.
2. Inspect the requested scope or current diff.
3. Trace data from UI/storage to every network, log, notification, route, telemetry, crash-reporting, and accessibility boundary.
4. Verify:
   - raw entries and user-authored wiki text never leave the device;
   - master keys and recovery material are never transmitted or logged;
   - sync payloads remain authenticated ciphertext with unique nonces;
   - tokens remain in Keychain/Keystore, never AsyncStorage or SQLite;
   - logout/account deletion preserve the documented wipe and remote-purge ordering;
   - Cloudflare code never attempts to decrypt user content or use Node-only APIs;
   - accessibility labels do not expose authored text;
   - crisis and personalization copy remains tentative, non-diagnostic, and evidence-backed.
5. Check focused tests in `__tests__/services/auth`, `__tests__/services/sync`, `__tests__/server`, and `__tests__/plugins` as applicable.
6. Report findings severity-first with clickable `file:line`, a concrete failure scenario, and the smallest fix. Say explicitly when no verified issue survives.

Never include real journal text, keys, tokens, recovery phrases, or ciphertext in the report.
