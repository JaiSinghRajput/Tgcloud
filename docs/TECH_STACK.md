# Technology Stack

## Selected stack

| Layer              | Selection                                                                 | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mobile UI          | React Native + TypeScript                                                 | Screens, navigation, state and shared business logic                                       |
| Native Android     | Kotlin + Android SDK                                                      | MediaStore, permissions, background execution, notifications, native transfer coordination |
| Telegram           | Official TDLib via Kotlin integration                                     | Telegram authentication, channels, message history and file transfer                       |
| Background work    | WorkManager; foreground service/long-running worker when appropriate      | Persistent scheduling, eligible transfers, retry and reconciliation                        |
| Local database     | SQLite                                                                    | Media index, job queues, settings, message references, restore state                       |
| Local media access | MediaStore + content URIs                                                 | Discover and read permitted gallery media                                                  |
| Secret protection  | Android Keystore                                                          | Protect local secret material and key-encryption keys                                      |
| Media encryption   | Vetted authenticated-encryption library, e.g. AES-256-GCM                 | Optional client-side media encryption                                                      |
| Optional backend   | Node.js + TypeScript + Express only if required                           | Opt-in diagnostics and non-sensitive account-independent features                          |
| Tests              | Jest, React Native Testing Library, Kotlin/JUnit, Android instrumentation | UI, logic, native and device integration                                                   |
| Build              | Gradle + CI                                                               | Reproducible Android builds and release validation                                         |

## Architectural tradeoffs

### React Native + Kotlin

Advantages: shared TypeScript UI and business logic; direct native APIs for Android-specific work; native transfer tasks need not depend on a live JavaScript runtime.
Costs: two languages, typed bridge maintenance, native build configuration, more complex debugging.

Decision: keep UI and ordinary application logic in TypeScript. Keep MediaStore scanning, persistent transfer coordination, TDLib integration and platform-sensitive security operations native.

### TDLib integration

Prefer official TDLib through a Kotlin integration rather than relying on a new or unverified JavaScript wrapper for core data movement. Validate exact APIs and Android compatibility in a proof of concept before committing to the full implementation.

### SQLite vs SQLCipher

SQLite is selected for simplicity and mature tooling. Standard SQLite does not encrypt database files. If sensitive metadata must be encrypted at rest, use field-level encryption or adopt SQLCipher after validating native integration, key management and migration behavior.

### Backend

No mandatory backend. The core upload/restore path must work without the developer's service. Add Node.js/Express only for a concrete optional feature; do not proxy media or Telegram credentials through it.

## Versioning policy

- Pin compatible versions of React Native, Android Gradle Plugin, Kotlin, TDLib and native dependencies.
- Record tested versions in the repository and update them deliberately.
- Do not invent or guess library APIs. Check official documentation and compile-time definitions.
- Avoid choosing a dependency solely because a wrapper exists; assess maintenance, licensing, Android support and security posture.
