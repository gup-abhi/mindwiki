# MindWiki — Privacy and Security
# Privacy promise: "Even we can't read your journal."
#
# Encryption stack:
#   At-rest: SQLCipher AES-256-GCM, key in Keychain/Keystore
#   Sync: AES-256-GCM, per-record HKDF key
#   Key escrow: AES-GCM(master_key, Argon2(password, salt)) — server cannot decrypt
#   In transit: TLS 1.3
#
# Security audit checklist (run before every release):
#   ✓ No raw entry text in any fetch() body
#   ✓ No master key in logs or sync payloads
#   ✓ No user content in crash reporters
#   ✓ AES-GCM nonces are unique (random)
#   ✓ Privacy Nutrition Label is minimal
#   ✓ GDPR data deletion flow works
#   ✓ Mental health disclaimer shown at onboarding
