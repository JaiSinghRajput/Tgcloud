# Architecture Decisions and Open Validation Gates

## Confirmed decisions

1. **Platform:** Android first.
2. **Mobile architecture:** React Native + TypeScript with native Kotlin modules.
3. **Local database:** SQLite.
4. **Backend:** minimal optional backend for diagnostics and account-independent features; not required for core backup/restore.
5. **Telegram integration:** Telegram client API via TDLib/Kotlin integration; not Bot API.
6. **Storage layout:** two private Telegram channels per user, photos and videos; folders reconstructed virtually from metadata.
7. **Initial backup:** scan first, show review and estimated size, require explicit confirmation.
8. **Folder defaults:** include all accessible supported folders by default; users can exclude folders.
9. **Network policy:** Wi-Fi-only or Wi-Fi plus cellular; charging preference may be offered.
10. **Deletion default:** local deletion does not delete cloud copies; cloud deletion requires explicit confirmation.
11. **Encryption:** optional client-side encryption with recovery setup and verification.
12. **Index:** local SQLite index is rebuildable from Telegram channel history and metadata.
13. **Background guarantee:** best-effort; Android restrictions must be disclosed.
14. **Toolchain & Framework (Phase 0):** React Native 0.88.0 + TypeScript, Kotlin 2.2.0, Gradle 9.4.1, Min SDK 26, Target SDK 36, Compile SDK 37. Chosen for native Android interoperability (WorkManager, MediaStore, TDLib native bindings) alongside strict type-safe UI and domain state management.
15. **TDLib Integration (Phase 1):** `io.github.tdlib-android:core:0.1.1` and `io.github.tdlib-android:ktx:0.1.1` (TDLib 1.8.x). Precompiled 4-ABI AAR (`arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86`) on Maven Central with 16KB page alignment and Kotlin Flow wrappers, eliminating local NDK compilation while preserving native `org.drinkless.tdlib` types.
16. **Domain Model & SQLite Architecture (Phase 2):** Defined Schema V1 with 7 tables (`media_items`, `telegram_objects`, `upload_jobs`, `media_versions`, `folder_exclusions`, `backup_settings`, `restore_jobs`). Enforced state transitions centrally through `assertMediaTransition` and idempotency keys (`mediaId:v{version}:{hash}`) to prevent duplicate uploads upon process kill or network recovery.
17. **Restore & Index Recovery Architecture (Phase 6):** Validated Gate B via `rebuildIndexFromRemoteHistory` by paginating remote Telegram channel messages, parsing `#TGB1:` caption envelopes, and recovering local SQLite state without prior local database state. Established collision resolution policies (`skip`, `keep_both` with automatic numeric suffix, and `replace`) and tracked restore jobs with resume capability and graceful handling of missing or deleted remote objects.

## Required validation gates

### Gate A — TDLib feasibility

Verify the exact APIs for authorization, channel creation, posting, history, media upload/download, progress reporting, rate limits and Android compatibility. Record the tested version and behavior. Do not build the full application until this works.

### Gate B — metadata recoverability

Prove that a clean installation can rebuild the virtual gallery from remote channel history without relying on the previous SQLite database. Define a format that does not leak sensitive metadata in encrypted mode.

### Gate C — transfer idempotency

Demonstrate reconciliation after the remote upload succeeds but local state is not committed. Avoid blind retries that create duplicates.

### Gate D — background behavior

Test WorkManager/foreground transfer behavior on supported Android versions and at least a representative real device. Document known OEM battery restrictions.

### Gate E — encryption design

Finalize and review the key hierarchy, KDF, metadata encryption, recovery format, key rotation and temporary-file policy before production implementation.

### Gate F — release policy

Review Telegram API terms, Telegram account restrictions/rate limits, Android permissions, privacy policy and distribution requirements.

## Open product decisions (do not silently guess)

- Minimum Android version and target SDK.
- Whether to ship encryption in the first public MVP or release it after a separate security review.
- Whether SQLCipher is needed for local database-at-rest encryption.
- Maximum concurrent transfers and practical file-size behavior under TDLib.
- Exact metadata marker and whether metadata is in captions, encrypted sidecars, or both.
- Diagnostics retention period and hosting provider, if diagnostics backend is enabled.
- Whether the first release is personal/sideloaded or intended for public app-store distribution.

When a decision affects security, recoverability or Telegram compatibility, document options and evidence before choosing.
