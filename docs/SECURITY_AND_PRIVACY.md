# Security, Encryption and Privacy

## Security principles

- The app developer's backend must never receive Telegram passwords, login codes, reusable session credentials, media files or encryption recovery material.
- Telegram session data and TDLib local state must be stored in app-private storage and protected appropriately.
- Use Android Keystore for local secret protection where possible.
- Never log tokens, authentication codes, recovery keys, plaintext media, full file paths or sensitive filenames.
- Request the minimum Android permissions needed and explain why each permission is required.
- Make diagnostic collection opt-in, minimized and separately documented.

## Encryption mode

Encryption is optional. When enabled:

- Encrypt each media item before upload using a vetted authenticated-encryption implementation, such as AES-256-GCM.
- Generate a fresh random data-encryption key per item and use unique nonces.
- Define a versioned envelope containing algorithm, key version, nonce, ciphertext/tag and non-sensitive parameters.
- Protect file keys using a master key; protect the master key with a user-controlled recovery mechanism.
- Derive key-encryption material from the recovery secret using a vetted password-based KDF with documented parameters. Never invent a custom cipher or KDF.
- Verify recovery setup before treating encrypted backup as operational.
- Encrypt thumbnails and sensitive metadata if they are uploaded.
- Ensure plaintext metadata is not leaked through captions, filenames, logs or analytics when privacy mode claims to conceal it.

The exact key hierarchy, KDF, recovery format and rotation strategy must be reviewed before production release. A recovery key is not the same as Telegram account access; both are needed to restore encrypted content.

## Threats and limitations

- Private Telegram channels are not end-to-end encrypted storage.
- Anyone with sufficient access to the Telegram account/channel may access unencrypted uploaded content.
- Telegram may apply rate limits, restrict account activity or change platform behavior.
- Losing the Telegram account can make the remote backup inaccessible.
- Losing encryption recovery material can make encrypted media permanently unrecoverable.
- Device compromise can expose media while it is being accessed/decrypted.
- Standard SQLite does not encrypt database files by default.
- Android backups, logs, crash reports and temporary files can accidentally expose sensitive data if not configured carefully.

## Temporary files and restore

- Use app-private temporary storage for downloads and decryption.
- Clean up temporary plaintext after success/failure according to a documented policy.
- Avoid plaintext copies in public shared storage until the user explicitly restores there.
- For restore to shared media storage, use Android-supported APIs and explain the destination.

## Diagnostics privacy

Allowed examples: app version, Android version, coarse error category, operation duration, and non-identifying job correlation ID, with consent.

Forbidden examples: media content, file name, full path, recovery key, encryption key, Telegram login code, Telegram password, session token or raw TDLib database contents.

## Release checklist

- Threat model reviewed.
- Encryption implementation and key hierarchy reviewed.
- Recovery flow tested on a clean install.
- Secret and metadata logging audit complete.
- Diagnostics consent and data-retention behavior documented.
- Privacy policy accurately describes Telegram storage and optional encryption.
- Account disconnect and local data deletion behavior documented.
