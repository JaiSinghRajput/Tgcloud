# Backup State Machine and Retry Rules

## Media lifecycle

```text
Discovered
  -> Excluded
  -> Queued
  -> WaitingForNetwork
  -> Uploading
  -> Verifying
  -> BackedUp

Uploading / Verifying -> RetryPending -> Queued
Discovered / BackedUp -> Changed -> Queued
Any applicable state -> PermissionRequired / SourceUnavailable / AuthRequired / PermanentFailure
BackedUp -> CloudMissing (when reconciliation confirms remote object unavailable)
CloudMissing -> RepairQueued (if a valid local source exists and user permits repair)
```

States should be represented with enums/constants, not arbitrary strings scattered across the codebase. Define valid transitions centrally.

## State meanings

- `Discovered`: scanned but not yet eligible/confirmed for upload.
- `Excluded`: excluded by folder or user policy.
- `Queued`: persisted and eligible for processing.
- `WaitingForNetwork`: policy constraints are not currently met.
- `Uploading`: transfer initiated; progress may be available.
- `Verifying`: remote message/file and metadata are being checked.
- `BackedUp`: remote reference is persisted and verification succeeded.
- `RetryPending`: retry is scheduled after a transient error.
- `Changed`: local content changed since the last verified version.
- `PermissionRequired`: access to the source is unavailable.
- `SourceUnavailable`: source file no longer accessible; no infinite retry.
- `AuthRequired`: Telegram session must be reauthorized.
- `PermanentFailure`: error needs user action or code correction.
- `CloudMissing`: a previously indexed remote object could not be found.

## Retry policy

- Retry transient network/server errors with exponential backoff and jitter.
- Respect explicit retry-after/rate-limit delays when exposed by the library.
- Do not retry permanent errors indefinitely.
- Authentication errors pause Telegram-dependent work and request user action.
- Permission errors require renewed permission or a fresh scan.
- A missing local source becomes `SourceUnavailable` until rediscovered.
- A missing remote object becomes `CloudMissing`; do not silently mark it backed up.

## Idempotency and uncertain outcomes

If the app is terminated after Telegram accepts an upload but before SQLite is updated, a blind retry can create a duplicate. Before retrying an uncertain transfer:

1. Query the relevant channel/history or use a verified app-specific marker to locate the prior upload.
2. Match media ID/version and, where available, content hash and size.
3. Persist the discovered remote reference if matched.
4. Upload a new message only when reconciliation finds no matching object.

Do not assume a Telegram send request has an idempotency key unless the selected API explicitly documents one.

## Queue behavior

- Persist before dispatch.
- Claim jobs atomically.
- Keep concurrency conservative initially.
- Never hold a SQLite transaction open during transfer.
- Persist progress checkpoints only when useful; do not write every progress tick to disk.
- Reconcile stale `Uploading` or `Verifying` jobs at app start and worker restart.
- Pause/resume must not discard queue records.

## Dashboard mapping

Dashboard counts are derived from current persisted states. Pending should exclude `Excluded`, `BackedUp` and terminal failures unless the UI explicitly labels those categories separately. Failed and retry-pending must not be conflated with never-attempted queued items.
