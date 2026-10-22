# Telegram / TDLib Integration Plan

## Purpose

Define a validation-first integration. TDLib is the preferred official Telegram client library, but its exact behavior and required API surface must be confirmed against the version pinned by the project.

## Proof of concept — required before app-wide integration

Build a small native Android/Kotlin prototype that demonstrates:

1. TDLib initialization and secure local state handling.
2. Telegram authorization flow without sending credentials to the developer's backend.
3. Creating or identifying a private channel and confirming the user can post/read it.
4. Uploading a small photo and video.
5. Adding a compact app-specific metadata marker/payload.
6. Reading channel history with pagination and reconstructing the app's records.
7. Downloading the original media and validating content/metadata.
8. Recovering after network interruption and app process death.
9. Handling rate limits, auth expiry and missing files.
10. Verifying supported media size limits and any required TDLib file handling behavior.

Record tested TDLib version, Android versions, API calls, known limitations and sample test outcomes in `DECISIONS.md` or a separate technical decision record.

## Channel organization

- One private channel for photos.
- One private channel for videos.
- No channel per folder.
- Original folder structure is virtual and reconstructed from versioned metadata.
- Channel/message IDs must be persisted locally but recoverable by scanning channel history.

## Metadata

Use a versioned, app-specific marker so messages can be distinguished from unrelated content. Define canonical parsing, validation and migration behavior. Keep captions compact. In encrypted mode, do not expose sensitive filenames or paths in plaintext captions.

The metadata design must support:

- stable app media ID;
- media type and metadata schema version;
- original filename and relative path, encrypted when required;
- MIME type and byte size;
- content version and optional hash;
- encryption envelope reference/parameters when enabled.

Do not store the entire local SQLite database in message captions.

## Transfer reliability

- Track transfer state locally before/while using TDLib.
- Use progress updates where the API exposes them.
- Confirm upload completion and persist the resulting remote message reference.
- Reconcile uncertain sends before retrying to avoid duplicates.
- Paginate history and avoid downloading every file just to rebuild the index when metadata is sufficient.
- Do not assume a remote file ID is permanent across sessions or contexts unless documented.

## API policy and operational caveats

- Do not use the Bot API for the primary client workflow.
- Do not bypass rate limits or abuse prevention.
- Review Telegram API terms and distribution policies before public release.
- Do not represent Telegram as a guaranteed backup provider.
- The integration must remain usable without the optional application backend.
