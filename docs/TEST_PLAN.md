# Test Plan

## Unit tests — TypeScript

- Dashboard counts derived from item/job states.
- Folder exclusion rules.
- Media eligibility and duplicate-candidate matching.
- Conflict policy selection.
- Metadata schema parsing, version compatibility and malformed records.
- UI behavior for pause/resume, scan confirmation and error messaging.

## Unit tests — Kotlin

- Valid/invalid state transitions.
- Retry delay and retry classification.
- Network-policy evaluation.
- Queue claiming and idempotency key behavior.
- Repository transactions and migrations.
- Metadata serialization/parsing.
- Crypto envelope parsing and invalid-tag rejection (using a vetted implementation).

## Integration tests

- TDLib authorization and reconnect.
- Create/find photo and video channels.
- Upload photo/video and retrieve message metadata.
- History pagination and index rebuild.
- Download and content verification.
- Uncertain upload reconciliation after process termination.
- Missing message and invalid session handling.

## Android device tests

- Android versions with different media permission behavior.
- Partial media access where supported.
- Large photo/video libraries.
- Large files and low free storage.
- Wi-Fi-to-cellular transition and Wi-Fi-only policy.
- Backgrounding app, force process death, reboot and battery restrictions.
- Revoked permission and source file removed mid-transfer.
- Restore to existing filename with skip/keep-both/replace.
- Storage-provider and removable-volume edge cases where applicable.

## Security tests

- No secrets in logs, analytics or crash reports.
- Recovery material is not sent to backend or Telegram in plaintext.
- Encryption tampering is detected.
- Recovery on clean install succeeds with correct material and fails safely with incorrect material.
- Sensitive metadata is not leaked in captions when privacy mode requires concealment.
- Temporary plaintext is cleaned up according to policy.

## Acceptance scenarios

1. Confirm initial scan; kill app during upload; reopen; same item eventually reaches `BackedUp` without an avoidable duplicate.
2. Turn off Wi-Fi in Wi-Fi-only mode; no new cellular transfer starts; queued work resumes when allowed network returns.
3. Delete local source after successful backup; cloud copy remains.
4. Reinstall app, reconnect Telegram and rebuild index from channel history.
5. Restore an item to a location with a filename collision and apply each supported conflict policy.
6. Simulate rate limit/auth expiry; dashboard shows actionable status and queue remains intact.
7. Disable optional backend connectivity; backup and restore still work.
8. Enable encryption, upload, reinstall, provide recovery material and restore identical bytes.
