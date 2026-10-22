# Data Model and Metadata Format

This document defines a logical schema. The implementation may adjust column names/types but must preserve the stated invariants and migration safety.

## SQLite tables

### `media_items`

- `id TEXT PRIMARY KEY` — app-generated stable ID.
- `source_key TEXT` — stable MediaStore identifier/volume context when available.
- `media_type TEXT NOT NULL` — `photo` or `video`.
- `display_name TEXT NOT NULL` — original filename; encrypt or protect when privacy mode requires it.
- `relative_path TEXT` — virtual relative path; protect when privacy mode requires it.
- `mime_type TEXT`, `size_bytes INTEGER`, `modified_at_ms INTEGER`, `created_at_ms INTEGER`.
- `content_hash TEXT NULL` — optional SHA-256 or stronger modern hash as required by implementation; do not hash every large item unnecessarily without profiling.
- `state TEXT NOT NULL`, `is_excluded INTEGER NOT NULL DEFAULT 0`.
- `last_scanned_at_ms INTEGER`, `created_at_ms_local INTEGER`, `updated_at_ms_local INTEGER`.

### `telegram_objects`

- `id TEXT PRIMARY KEY`.
- `media_item_id TEXT NOT NULL` — references `media_items.id`.
- `channel_id TEXT NOT NULL`, `message_id TEXT NOT NULL`.
- `remote_file_id TEXT NULL` — only if useful and stable under TDLib semantics; do not assume it is a permanent cross-session identifier.
- `metadata_version INTEGER NOT NULL`.
- `content_hash TEXT NULL`, `uploaded_at_ms INTEGER`, `verified_at_ms INTEGER`.
- `status TEXT NOT NULL` — e.g. available, missing, verification_pending.
- Unique constraint on the applicable channel/message reference.

### `upload_jobs`

- `id TEXT PRIMARY KEY`, `media_item_id TEXT NOT NULL`.
- `state TEXT NOT NULL`, `attempt_count INTEGER NOT NULL DEFAULT 0`.
- `next_attempt_at_ms INTEGER NULL`, `last_error_code TEXT NULL`, `last_error_summary TEXT NULL`.
- `created_at_ms INTEGER NOT NULL`, `updated_at_ms INTEGER NOT NULL`.
- Use an idempotency/deduplication key to prevent multiple active jobs for the same media version.

### `media_versions`

- `id TEXT PRIMARY KEY`, `media_item_id TEXT NOT NULL`, `version_number INTEGER NOT NULL`.
- `content_hash TEXT NULL`, `size_bytes INTEGER`, `modified_at_ms INTEGER`.
- `telegram_object_id TEXT NULL`, `state TEXT NOT NULL`, timestamps.
- Keep old cloud versions until the new upload has been verified and version policy is applied.

### `folder_exclusions`

- `id TEXT PRIMARY KEY`, `folder_key TEXT NOT NULL UNIQUE`, `display_label TEXT`, `created_at_ms INTEGER NOT NULL`.
- Store a robust folder key; paths may change and may need normalization.

### `backup_settings`

- Use a singleton settings row or key/value table for network policy, charging preference, encryption mode, local deletion policy, cloud deletion confirmation and scan settings.
- Do not store plaintext recovery keys in this table.

### `restore_jobs`

- `id TEXT PRIMARY KEY`, `telegram_object_id TEXT NOT NULL`.
- `destination_uri TEXT NULL`, `conflict_policy TEXT NOT NULL`, `state TEXT NOT NULL`.
- `attempt_count INTEGER`, `last_error_code TEXT`, timestamps.

## State invariants

- A media item is not `BackedUp` until the remote upload has been verified sufficiently for the chosen TDLib workflow and its channel/message reference is persisted.
- A job must be persisted before it starts a transfer.
- Network I/O must not occur inside a database transaction.
- A retry must reconcile uncertain remote success before sending another message.
- Local deletion does not delete the remote record by default.
- Exclusion prevents new uploads but does not silently delete existing cloud copies.
- All schema changes require migrations and migration tests.

## Metadata envelope

Use compact, versioned metadata. Example only:

```json
{
  "schemaVersion": 1,
  "app": "telegram-gallery-backup",
  "mediaId": "generated-stable-id",
  "mediaType": "photo",
  "originalName": "IMG_20261022.jpg",
  "relativePath": "DCIM/Camera/IMG_20261022.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 2845678,
  "modifiedAtMs": 1792660000000,
  "contentHash": null,
  "encryption": null
}
```

Illustrative timestamps and identifiers are not real records. The implementation must define canonical serialization, validation, maximum metadata size and forward-compatible parsing.

For encrypted mode, do not place plaintext filenames, paths or hashes in message captions if privacy mode promises those fields are hidden. Use a compact non-sensitive envelope or opaque versioned marker in the caption and store the sensitive metadata inside an encrypted payload/sidecar. The design must ensure a fresh installation can discover and decrypt metadata with the recovery material.

## Rebuildability

The local index must be reconstructable from the two Telegram channels and their versioned metadata. Store Telegram channel/message references locally for speed, but do not require the local database to survive reinstall. Document which metadata must be present remotely for full recovery.
