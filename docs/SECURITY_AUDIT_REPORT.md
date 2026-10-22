# Security & Privacy Audit Report

**Date:** October 2026  
**Status:** ALL RELEASE GATES PASSED (Gate E & Security Checklist Verified)  
**App:** Telegram Gallery Backup for Android

---

## 1. Executive Summary

This report documents the security, encryption, and privacy audit performed in accordance with **PRD Section 10**, **Gate E**, and `docs/SECURITY_AND_PRIVACY.md`.

All data transfer and client-side MTProto communication are executed strictly between the user's Android device and Telegram servers via TDLib. There is **no developer backend** for media storage, authentication credentials, or encryption keys.

---

## 2. Cryptographic Architecture (Gate E Review)

| Primitive                   | Implementation                      | Specification / Parameters                                              | Verification Status |
| :-------------------------- | :---------------------------------- | :---------------------------------------------------------------------- | :------------------ |
| **Cipher**                  | AES-256-GCM                         | Authenticated encryption with 128-bit authentication tags               | PASS                |
| **DEK Generation**          | SecureRandom / `crypto.randomBytes` | Fresh 256-bit random DEK per media item                                 | PASS                |
| **Nonce / IV**              | Cryptographically random            | Unique 96-bit (12-byte) IV per operation (never reused)                 | PASS                |
| **Key Derivation (KDF)**    | PBKDF2-HMAC-SHA256                  | 100,000 iterations with 16-byte random salt                             | PASS                |
| **Master Key Verification** | AES-256-GCM Token                   | Encrypted verification payload `TGB_RECOVERY_KEY_VERIFIED_V1`           | PASS                |
| **Tamper Detection**        | AEAD Auth Tag Verification          | Immediate exception on bit-flip; zero unauthenticated plaintext emitted | PASS                |
| **Temporary File Wiping**   | `TelegramCryptoService.secureWipe`  | Multi-pass zero-overwrite before file deletion in `finally` blocks      | PASS                |

---

## 3. Plaintext Metadata Leakage Audit

### Audit Requirement

When client-side encryption is armed, sensitive user metadata (original filenames, relative folder paths, content hashes, and MIME types) must never be transmitted in plaintext or visible in Telegram message captions.

### Audit Results

- **Message Caption:** The `#TGB1:` caption envelope uses generic masked placeholders:
  - `originalName`: `"encrypted.bin"`
  - `relativePath`: `""`
  - `contentHash`: `null`
  - `mimeType`: `"application/octet-stream"`
- **Encrypted Sidecar / Envelope:** Sensitive metadata is serialized to JSON, encrypted with the item's DEK using AES-256-GCM, and stored inside the `enc` envelope.
- **Index Recoverability:** On clean installations, entering the 12-word recovery passphrase unlocks the Master Key, decrypts the DEK and metadata sidecar, and successfully reconstructs the complete virtual gallery and folder hierarchy.
- **Automated Verification:** Verified via automated unit test `__tests__/encryption.test.ts` (Plaintext Metadata Leakage Audit).

---

## 4. Secret & Credential Logging Audit

A full codebase scan was conducted across all Kotlin, TypeScript, and logging channels:

| Target                     | Policy                  | Verification Result                                                          |
| :------------------------- | :---------------------- | :--------------------------------------------------------------------------- |
| **Telegram Login Codes**   | NEVER LOGGED            | Verified: No logs print SMS/Telegram login codes                             |
| **2FA Passwords**          | NEVER LOGGED            | Verified: Password inputs are transient and not logged                       |
| **Recovery Passphrases**   | NEVER LOGGED            | Verified: Normalized and passed directly to KDF; omitted from console/logcat |
| **TDLib Auth Tokens**      | ISOLATED IN APP STORAGE | Stored exclusively in sandboxed `context.filesDir/tdlib`                     |
| **Filenames / Full Paths** | REDACTED IN TELEMETRY   | Sanitized to item IDs; never included in logs or diagnostics                 |

---

## 5. Diagnostics & Privacy Telemetry (PRD Section 5.8)

- **Default State:** Opt-in only (`isOptedIn = false` by default).
- **Scrubbing:** Telemetry strictly prohibits and rejects payloads containing any of the forbidden keys:
  `filename`, `originalName`, `displayName`, `path`, `relativePath`, `content`, `media`, `bytes`, `recoveryKey`, `masterKey`, `password`, `code`, `token`, `session`.
- **Immediate Purge:** Toggling off diagnostics immediately purges all buffered logs from memory and storage.
- **Automated Verification:** Verified in `__tests__/hardening.test.ts`.

---

## 6. Threat Model & User Guidance

1. **Telegram Cloud:** Private Telegram channels are NOT end-to-end encrypted by Telegram. Enabling Client-Side Encryption guarantees zero-knowledge storage where Telegram only receives AES-256-GCM ciphertext.
2. **Key Loss Warning:** Displayed prominently in `SettingsScreen`:
   > _"If you lose your recovery passphrase, your backups will be PERMANENTLY UNRECOVERABLE. Telegram cannot recover them."_
3. **Local Sandboxing:** TDLib local database and SQLite database are stored in Android private app storage (`/data/data/com.telegramgallerybackup.app/files`), protected by Linux user sandboxing and SELinux.
