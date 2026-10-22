# TDLib Proof of Concept Report (Phase 1 — Gate A)

## 1. Overview and Version Choices

| Component                    | Selected Version                            | Notes                                             |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------- |
| TDLib Distribution           | `io.github.tdlib-android:core:0.1.1`        | Maven Central prebuilt AAR (BSL-1.0)              |
| Kotlin Flow Extension        | `io.github.tdlib-android:ktx:0.1.1`         | Reactive coroutines wrapper (Apache-2.0)          |
| Underlying TDLib Engine      | TDLib 1.8.x (`libtdjson.so`)                | Official C++ MTProto client engine                |
| Android Min SDK              | API 26 (Android 8.0 Oreo)                   | Required by TDLib native prebuilts                |
| Android Target / Compile SDK | API 36 / API 37                             | Modern Android 15/16 forward compatibility        |
| Memory Page Alignment        | 16 KB page-aligned                          | Compliant with Android 15+ 16 KB page requirement |
| Supported ABIs               | `arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86` | All 4 physical device and emulator architectures  |

## 2. Architecture & Native Module Implementation

The TDLib integration is implemented directly in native Kotlin without any intermediary developer backend:

1. **`TdLibService.kt`**:

   - Manages TDLib native client lifecycle (`Client.create`).
   - Isolates TDLib database directory (`context.filesDir/tdlib`) and media files directory (`context.filesDir/tdlib_files`).
   - Converts asynchronous callback-based TDLib requests into suspending Kotlin coroutines (`suspend fun <T> send(...)`).
   - Dispatches incoming MTProto updates into a reactive `SharedFlow<TdApi.Update>` and auth updates into `StateFlow<TelegramAuthState>`.
   - Disables verbose native logging to prevent leakage of credentials or personal data.

2. **`TelegramChannelManager.kt`**:

   - Manages the two private channels required by `DECISIONS.md`:
     - Photos channel: `Backup - Photos`
     - Videos channel: `Backup - Videos`
   - Discovers existing channels via `SearchChatsOnServer` or creates new private broadcast channels via `CreateNewSupergroupChat(isChannel = true)`.
   - Validates write/post permissions for the authenticated user.

3. **`TelegramMetadataEnvelope.kt`**:

   - Attaches a compact, versioned metadata marker (`#TGB1:{...}`) to Telegram message captions.
   - Encodes schema version, mediaId, original name, relative path, MIME type, byte size, modification timestamp, content hash, and optional encryption parameters.
   - Validates and parses metadata when paginating channel history to rebuild the local index.

4. **`TelegramMediaManager.kt`**:

   - Uploads photos via `SendMessage` with `InputMessagePhoto` and videos with `InputMessageVideo`.
   - Implements duplicate detection and reconciliation before dispatching transfers: queries channel history to locate prior uploads matching `mediaId` and hash.
   - Paginates channel history via `GetChatHistory`.
   - Downloads media files via `DownloadFile` and tracks progress via `UpdateFile`.

5. **`TelegramPocRunner.kt`**:

   - Executes the 10-step validation harness:
     1. Storage Initialization
     2. Auth State Check
     3. Channel Setup
     4. Test Media Generation
     5. Metadata Envelope Generation
     6. Media Upload with Metadata
     7. History Read & Metadata Reconstruction
     8. Transfer Idempotency Reconciliation
     9. Media Download & Verification
     10. Temporary File Cleanup

6. **`TelegramBridgeModule.kt` & `TelegramPackage.kt`**:
   - Bridges native methods to React Native with typed Promises and event listeners.

## 3. Limits and Constraints Observed

- **Channel Hierarchy:** Telegram channels cannot be nested; virtual folders must be reconstructed from caption metadata.
- **Rate Limits:** Flood-wait responses (`429 FLOOD_WAIT_X`) must be respected; sequential transfers with conservative concurrency (1 transfer at a time) are required.
- **File Sizes:** TDLib supports up to 2 GB per file for standard users and 4 GB for Telegram Premium users.
- **Session Protection:** Database files are stored in app-private sandboxed storage (`context.filesDir/tdlib`).
