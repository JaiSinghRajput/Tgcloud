# Product Requirements Document — Telegram Gallery Backup

## 1. Product summary

Build an Android application that backs up accessible photos and videos from a user's device gallery to the user's own Telegram account. Users can review the initial scan, select excluded folders, monitor backup progress, browse backed-up media, and restore individual items or collections. Backup must continue on a best-effort basis when the app is backgrounded, subject to Android restrictions and user settings.

This is an unofficial app. Telegram is being used as a user-controlled destination, not as a guaranteed backup-storage service.

## 2. Goals

- Back up accessible gallery photos and videos to two private Telegram channels: one for photos and one for videos.
- Preserve original filenames and reconstruct virtual folder structure using versioned metadata.
- Discover new media and queue it without requiring manual upload of each item.
- Avoid duplicate uploads and recover from interrupted transfers.
- Allow browsing, searching, selective restore and full restore.
- Offer optional client-side encryption with an explicit recovery flow.
- Keep the core backup/restore path independent of any developer-operated backend.

## 3. Non-goals for MVP

- iOS support.
- Developer-hosted media storage.
- Mandatory account system operated by the app developer.
- Social sharing, public galleries or channel sharing.
- Editing media inside the app.
- Guaranteeing immediate uploads while Android restricts background execution.
- Treating Telegram as a substitute for a second independent backup.

## 4. Core user journey

1. User reviews privacy, Telegram integration and permission explanations.
2. User grants access to the media required by the app.
3. User authenticates with Telegram using the supported client flow.
4. App creates or identifies the two private backup channels and verifies access.
5. App scans accessible photos/videos and estimates eligible backup size.
6. User reviews item counts, folders, exclusions, network policy and encryption choice.
7. User explicitly confirms the initial backup.
8. App persists upload jobs and processes the queue.
9. Dashboard displays backed-up, pending, uploading, failed and excluded counts.
10. User browses the cloud gallery and restores items as needed.

## 5. Functional requirements

### 5.1 Onboarding and initial scan

- Explain why media permissions are required and what data is uploaded.
- Use Android-supported media permissions and MediaStore/content URIs.
- Scan accessible photo and video collections; do not claim to see inaccessible files.
- Show discovered counts, estimated total bytes, eligible-to-upload counts and excluded counts separately.
- Show folder groups with counts and exclusion controls.
- Include all accessible supported folders by default; newly discovered folders are included unless excluded.
- Require explicit user confirmation before the initial upload begins.

### 5.2 Telegram setup

- Use the Telegram client API through TDLib, not the Bot API.
- Use two private channels per user: photos and videos.
- Do not create a channel for every local folder.
- Persist channel identifiers and message identifiers locally.
- Make metadata sufficient to rebuild the app's virtual folder tree from channel history.
- Handle expired/invalid authorization and offer a safe reconnect flow.

### 5.3 Automatic backup

- Detect newly discovered or changed media during scans and eligible scheduled work.
- Persist jobs before transferring data.
- Support pause/resume and manual rescan.
- Support Wi-Fi-only and Wi-Fi-plus-mobile-data policies; optionally support charging-only.
- Retry transient failures with exponential backoff and jitter.
- Avoid duplicate messages when a transfer is retried or app process is killed.
- Report auth failures, permission errors, rate limits, missing source files, and permanent failures distinctly.
- Background execution is best-effort; do not promise immediate or uninterrupted operation.

### 5.4 Duplicate detection and file changes

- Use stable Android media identifiers when available, plus file size, modification metadata and selective content hashing.
- Filename + size alone is not a sufficient identity check.
- Reconcile rename/move changes when identity can be established; update metadata without re-uploading identical content where feasible.
- Detect changed content and upload a new version according to the configured version policy.
- Retain the prior cloud version until the new version has uploaded and verified.

### 5.5 Cloud gallery and restore

- Reconstruct folders virtually from metadata; Telegram channels remain organized by media type.
- Support browsing by folder, date and media type; search by filename when metadata is available.
- Support single-item, multi-item and folder-level restore.
- Restore original filenames and relative folder structure where Android permits.
- Handle filename collisions with user-selectable `skip`, `keep both` or `replace` behavior.
- Persist restore jobs and recover after interruption.
- If a Telegram message/file is missing, mark it unavailable and offer repair/re-upload from a local source if available.

### 5.6 Deletion policy

- Default: deleting a local file does not delete its cloud backup.
- Never infer deletion solely because an item is absent from one scan.
- Cloud deletion requires an explicit action and confirmation.
- If deletion sync is later supported, make it opt-in, explain the consequences, and provide a recoverable/trash period where feasible.

### 5.7 Encryption

- Encryption is optional and must be clearly described before backup begins.
- When enabled, encrypt media before upload; any uploaded thumbnails and sensitive metadata must receive equivalent protection.
- A recovery key must be created, displayed securely and verified before encrypted backup is relied upon.
- Recovery requires both access to the Telegram account and the encryption recovery material.
- Warn that losing encryption keys can permanently prevent recovery.
- Do not describe private Telegram channels as end-to-end encrypted storage.

### 5.8 Optional diagnostics backend

- No backend is required for core backup, indexing or restore.
- A small optional service may receive opt-in, privacy-minimized diagnostic events and provide non-sensitive configuration.
- Never send media, encryption keys, Telegram passwords/codes, or reusable Telegram session credentials to this service.
- Diagnostics must not include media filenames, content or full local paths.

## 6. Dashboard requirements

Display at minimum:

- Total discovered supported media.
- Eligible items pending backup.
- Backed-up items.
- Currently uploading item and progress, where available.
- Failed/retry-pending items.
- Excluded items.
- Last successful backup time.
- Current network policy and pause/resume state.

Counts must derive from persisted job/item states, not from approximate UI-only counters.

## 7. Error and recovery behavior

- Process death: recover from persisted queue and reconcile uncertain uploads against Telegram metadata.
- Device reboot: reschedule eligible work and resume according to Android restrictions.
- Network loss: preserve progress/state and retry later.
- Rate limiting: honor server delay information where available; otherwise use conservative backoff.
- Authorization loss: pause Telegram-dependent jobs and prompt reconnect.
- Permission loss: mark affected items inaccessible; do not delete cloud copies.
- Source file missing: mark source unavailable and avoid endless retries.
- Cloud object missing: mark unavailable and offer repair where possible.
- Database migration failure: fail safely; never silently discard the only local mapping without recovery.

## 8. MVP acceptance criteria

- User can connect Telegram and verify access to the two private channels.
- Initial scan shows accurate counts for supported accessible media and excluded folders.
- No initial upload starts before explicit confirmation.
- A queued item survives app process termination and is not duplicated after retry.
- A completed item can be located in Telegram history and restored to the expected filename/path.
- A new media item is discovered by a subsequent scan and queued.
- Wi-Fi-only mode does not intentionally start transfers on cellular data.
- Cloud copies are retained when local files are deleted by default.
- Encrypted backup cannot be enabled as ready until recovery setup has been verified.
- Backup and restore work when the optional backend is unavailable.
- UI counts match persisted states after relaunch.

## 9. Product risks

- Telegram may rate-limit, restrict or change behavior for automated client usage.
- Android background execution and vendor battery management can delay work.
- Media permissions and access vary across Android versions and storage providers.
- TDLib integration may require native build and storage/session lifecycle work.
- Encryption makes previews, indexing and recovery more complex.
- Telegram account loss or account restrictions can affect availability of the backup.

## 10. Release gates

Before public release, validate Telegram API terms and rate limits, target Android requirements, permission disclosures, privacy policy, diagnostics consent, cryptography implementation, data deletion behavior and supported-device background behavior.
