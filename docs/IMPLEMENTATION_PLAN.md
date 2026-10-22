# Implementation Plan for the Coding Agent

## Phase 0 — Repository and decisions

- Create a native-capable React Native + TypeScript project.
- Pin initial toolchain versions and document Android SDK/Gradle/Kotlin compatibility.
- Add formatting, linting, type checking and unit-test commands.
- Create a technical decision log; no major dependency should be added without recording why.

**Exit criteria:** clean build on a documented Android emulator/device; CI can type-check and run unit tests.

## Phase 1 — TDLib proof of concept (highest risk)

- Add TDLib through a Kotlin integration.
- Implement authorization, private-channel setup, send media, read history and download media.
- Test process termination and network loss.
- Document limits and version choices.

**Exit criteria:** repeatable end-to-end upload/history/restore test on a real Android device or emulator, with no developer backend.

## Phase 2 — Domain model and SQLite

- Implement migrations and repositories for media items, remote references, upload jobs, versions, exclusions, settings and restore jobs.
- Implement central state-transition validation.
- Implement duplicate reconciliation rules.

**Exit criteria:** migration, state-transition, idempotency and repository tests pass.

## Phase 3 — Media discovery

- Implement permission handling and MediaStore scanning.
- Read accessible metadata and relative paths.
- Implement folder grouping/exclusion and scan review counts.
- Detect new/changed/inaccessible media without destructive assumptions.

**Exit criteria:** counts match test fixtures/device gallery; initial upload cannot start before user confirmation.

## Phase 4 — Persistent backup engine

- Persist jobs before dispatch.
- Integrate WorkManager and appropriate foreground transfer behavior.
- Implement network constraints, retry/backoff, pause/resume and stale-job reconciliation.
- Verify remote success before marking backed up.

**Exit criteria:** interruption/reboot/network-change tests do not lose jobs or create avoidable duplicate messages.

## Phase 5 — React Native product UI

- Onboarding and permissions explanations.
- Telegram connection/setup flow.
- Scan review and explicit confirmation.
- Backup dashboard and failure actions.
- Cloud gallery, filters/search and restore flows.
- Settings for network policy, exclusions, deletion policy and encryption.

**Exit criteria:** each visible status is driven by persisted state; all primary flows work without backend connectivity.

## Phase 6 — Restore and index recovery

- Implement remote-history index rebuild.
- Restore one item, multiple items and folders.
- Implement collision policies and interrupted restore recovery.
- Handle missing cloud objects.

**Exit criteria:** restore recreates expected filenames/paths and handles conflicts predictably.

## Phase 7 — Encryption

- Finalize reviewed key hierarchy and metadata privacy design.
- Implement encrypt/decrypt, recovery-key setup and verification.
- Test clean-install recovery, key loss messaging and temporary file cleanup.

**Exit criteria:** encrypted upload and restore round-trip passes; plaintext metadata leakage audit passes.

## Phase 8 — Hardening and release review

- Device matrix, battery restrictions, large libraries, storage pressure and error-path testing.
- Privacy/security review, diagnostics consent, API terms review and store policy review.
- Release build signing and operational documentation.

**Exit criteria:** all release gates in PRD and security checklist are met.

## Agent workflow rules

- Implement one phase at a time; do not skip the TDLib proof of concept.
- Before adding a dependency, explain its purpose and verify maintenance/compatibility.
- Do not create a backend merely to simplify native integration.
- Add tests with each meaningful behavior change.
- Keep secrets out of source control and logs.
- If a required Telegram API behavior is uncertain, stop and report the blocker instead of guessing.
