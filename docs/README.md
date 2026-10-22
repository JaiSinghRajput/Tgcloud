# Telegram Gallery Backup — Coding Agent Pack

This folder contains the working specification for the unofficial Telegram Gallery Backup Android app. Read the documents in the order below before implementing features.

## Reading order

1. `PRD.md` — product scope, requirements, user flows and acceptance criteria.
2. `TECH_STACK.md` — selected technologies and tradeoffs.
3. `ARCHITECTURE.md` — module boundaries and data flow.
4. `DATA_MODEL.md` — SQLite schema direction and metadata envelope.
5. `BACKUP_STATE_MACHINE.md` — transfer states, retries and reconciliation.
6. `SECURITY_AND_PRIVACY.md` — encryption, secrets, threat model and privacy requirements.
7. `TELEGRAM_INTEGRATION.md` — TDLib proof of concept and integration constraints.
8. `IMPLEMENTATION_PLAN.md` — phased delivery and coding-agent workflow.
9. `TEST_PLAN.md` — required automated and device tests.
10. `DECISIONS.md` — decisions already made and unresolved validation gates.

## Instructions to the coding agent

- Treat these documents as the current source of product requirements. If two documents conflict, prefer `DECISIONS.md`, then `PRD.md`, and document any proposed change before implementing it.
- Do not implement the entire application in one pass. Start with the Telegram/TDLib proof of concept and a technical decision record for any blocker.
- Do not fabricate APIs. Confirm the exact TDLib API and version from official documentation and compile-time bindings.
- Keep backup and restore independent of the optional backend.
- Do not claim guaranteed always-on background execution. Android can defer or restrict background work.
- Never log secrets, recovery keys, Telegram credentials, media contents, filenames, or full local paths.
- Use real device tests for Android background execution, permissions, large files, process death and reboot recovery.
- Keep the initial release Android-only.

## Status

This is an unofficial product/engineering specification, not an endorsement by Telegram. TDLib capabilities, Telegram API terms, Android distribution policies and operational constraints must be validated before release.
