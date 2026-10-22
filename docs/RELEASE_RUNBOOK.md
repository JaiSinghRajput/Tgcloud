# Release & Operations Runbook

**App Name:** Telegram Gallery Backup  
**Package:** `com.telegramgallerybackup.app`  
**Distribution:** Google Play Store (AAB) & GitHub Release (Universal APK)

---

## 1. Release Signing & Build Procedure

### 1.1 Keystore Generation

For production builds, generate a dedicated release signing key:

```bash
keytool -genkeypair -v -keystore release.keystore -alias tgb-release -keyalg RSA -keysize 4096 -validity 10000
```

### 1.2 Gradle Configuration

Place credentials securely in `android/gradle.properties` (or CI environment variables):

```properties
TGB_RELEASE_STORE_FILE=release.keystore
TGB_RELEASE_KEY_ALIAS=tgb-release
TGB_RELEASE_STORE_PASSWORD=your_secure_keystore_password
TGB_RELEASE_KEY_PASSWORD=your_secure_key_password
```

### 1.3 Generating Production Artifacts

In the `android/` directory, execute:

```bash
# Android App Bundle (for Google Play Console submission)
./gradlew bundleRelease

# Universal signed APK (for direct sideload / GitHub Releases)
./gradlew assembleRelease
```

Artifacts are produced at:

- `android/app/build/outputs/bundle/release/app-release.aab`
- `android/app/build/outputs/apk/release/app-release.apk`

---

## 2. ProGuard & R8 Optimization Verification

ProGuard configuration is maintained in `android/app/proguard-rules.pro`. When `enableProguardInReleaseBuilds = true` is set, R8 minifies Java bytecode while preserving:

- Native JNI methods and generated TDLib data structures:
  `-keep class org.drinkless.tdlib.** { *; }`
  `-keepclassmembers class org.drinkless.tdlib.** { *; }`
- React Native bridge modules and WorkManager worker classes.

---

## 3. Telegram API Terms of Service & Rate Limits

1. **Telegram API Compliance:**
   - The application functions as a standard third-party MTProto client under the Telegram API Terms of Service.
   - It communicates directly with Telegram endpoints via TDLib without intermediary developer proxy servers.
   - It does not scrape data from public groups or access chats other than the user's two dedicated private backup channels.
2. **Rate Limit Handling (`FLOOD_WAIT`):**
   - When Telegram returns `FLOOD_WAIT_X`, the backup engine parses the wait duration in seconds, pauses transfer dispatches for the specified interval plus jitter, and prevents automated reconnect spin loops.
3. **Account Safety:**
   - Batch uploads are throttled to sensible user-like rates.
   - Initial backup requires explicit user confirmation of folder selection and file count before any uploads begin.

---

## 4. Google Play Store Policy Checklist

| Policy Requirement                 | App Implementation & Evidence                                                                                                                                                                |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Media Permissions Declaration**  | Core app function is local gallery backup and restore. Permissions `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` are strictly essential.                                                        |
| **User Privacy Policy**            | Privacy policy clearly discloses that media is stored in the user's private Telegram channels, that client-side encryption is optional, and that no developer server collects personal data. |
| **Foreground Service (Data Sync)** | Used solely when active file transfers are in progress, accompanied by an ongoing notification with pause/cancel controls.                                                                   |
| **Zero Advertising / Tracking**    | Zero ad SDKs, zero analytics trackers, and zero third-party behavioral trackers.                                                                                                             |
| **16KB Page Size Alignment**       | Verified on all 4 ABIs using `io.github.tdlib-android:core:0.1.1`.                                                                                                                           |

---

## 5. Clean Install Recovery Verification Test

Before certifying any public release:

1. Complete a backup of test photos and videos (with client-side encryption enabled).
2. Uninstall the app completely from the test device (wiping all local SQLite database records).
3. Reinstall the app.
4. Log into Telegram using phone number and SMS code.
5. Enter the 12-word recovery passphrase.
6. Verify that `RestoreManager.rebuildIndexFromRemoteHistory` reconstructs all albums and files.
7. Perform a multi-item restore and verify binary hash equality with original files.
