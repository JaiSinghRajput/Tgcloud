# Architecture and Module Boundaries

## High-level components

1. **Presentation layer (React Native/TypeScript)** — onboarding, scan review, dashboard, cloud gallery, settings, restore UX.
2. **Application/domain layer (TypeScript where portable)** — user commands, validation, state presentation and domain types.
3. **Native bridge** — typed commands/events between React Native and Kotlin. Must handle cancellation, timeouts, errors and event subscription cleanup.
4. **Android media module (Kotlin)** — MediaStore queries, content URI access, permission state, media metadata and change discovery.
5. **Transfer coordinator (Kotlin)** — persistent scheduling, queue claiming, concurrency limits, retries and reconciliation.
6. **Telegram adapter (Kotlin/TDLib)** — authentication, channel setup, send/download operations, message history and remote reference mapping.
7. **Persistence module (SQLite)** — application metadata, job states, local index, settings and migrations.
8. **Crypto module** — file encryption/decryption, key hierarchy, recovery verification and encrypted metadata envelopes.
9. **Optional diagnostics client** — opt-in, sanitized events; never required by core operations.

## Dependency direction

UI -> application/domain APIs -> typed native bridge -> Kotlin modules.

The transfer coordinator uses repository interfaces and a Telegram adapter. The database stores state; it must not perform network operations. The optional backend client is isolated and must not be imported by the core backup engine.

## Suggested repository layout

```text
src/
  app/
  navigation/
  screens/
    onboarding/
    scan-review/
    dashboard/
    cloud-gallery/
    restore/
    settings/
  components/
  domain/
    media/
    backup/
    restore/
  services/
  native/
  state/
  types/
android/app/src/main/java/<package>/
  media/
  backup/
  telegram/
  database/
  crypto/
  bridge/
  workers/
  notifications/
```

Adapt the exact package name and file organization to the generated React Native project; do not create duplicate abstractions without need.

## Key flows

### Initial backup

Permission check -> MediaStore scan -> deduplication/reconciliation -> review UI -> explicit confirmation -> persist jobs -> WorkManager/foreground transfer execution -> verify remote message -> mark backed up.

### Incremental backup

Scheduled/manual scan -> compare stable identifiers and metadata -> queue new/changed items -> enforce network policy -> upload -> verify -> update message reference and item state.

### Restore

Read local index or rebuild from Telegram history -> select item(s) -> create restore jobs -> download to temporary location -> decrypt/verify if enabled -> resolve conflicts -> write to MediaStore or user-selected destination -> mark complete.

### Rebuild index

Authenticate -> inspect the app's two channels -> parse versioned metadata records -> rebuild local media and remote-reference mappings -> mark unresolved or duplicate records for review. Never assume local SQLite is the only source of truth.

## Concurrency and resource limits

- Use a conservative, configurable number of simultaneous transfers; start with one upload at a time until TDLib behavior and device resource use are validated.
- Avoid loading entire large media files into memory. Use file-based or streaming-compatible APIs where supported.
- Bound metadata history scans and paginate through remote history.
- Avoid holding database transactions open during network or file I/O.
- Persist state transitions atomically.

## Observability

Use structured internal logs with operation IDs and error categories. Redact access tokens, session data, recovery material, file names, full paths and content. Opt-in diagnostics must be separately sanitized and consented.
