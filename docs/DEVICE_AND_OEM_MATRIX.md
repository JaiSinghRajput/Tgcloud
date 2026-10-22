# Device Compatibility & OEM Battery Hardening Matrix

**Target Platform:** Android (Min SDK 26 · Target SDK 36 · Compile SDK 37)  
**Native Toolchain:** Kotlin 2.2 · React Native 0.88 · Gradle 9.4.1  
**Architecture Support:** `arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86` (16KB Page-Aligned)

---

## 1. Android OS Compatibility & Permission Matrix

Android's storage and media permissions evolved significantly across major releases. The app dynamically adapts to the host version:

| Android Version       | API Level | Required Permissions                                                             | Permission Behavior & UI Strategy                                                                                           |
| :-------------------- | :-------- | :------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **Android 14 & 15+**  | 34 - 36   | `READ_MEDIA_IMAGES`<br/>`READ_MEDIA_VIDEO`<br/>`READ_MEDIA_VISUAL_USER_SELECTED` | User may grant access to **selected photos only**. App respects partial access without assuming missing items were deleted. |
| **Android 13**        | 33        | `READ_MEDIA_IMAGES`<br/>`READ_MEDIA_VIDEO`                                       | Granular media permissions for photos and videos. Audio is not requested.                                                   |
| **Android 8.0 - 12L** | 26 - 32   | `READ_EXTERNAL_STORAGE`                                                          | Standard shared storage read permission. Handled through unified MediaScanner module.                                       |

### Android 15/16 16KB Page Size Alignment

Google Play requires 16KB page alignment on Android 15+ devices. TDLib native binaries (`libtdjni.so`) are sourced via `io.github.tdlib-android:core:0.1.1` from Maven Central, which is compiled with `-Wl,-z,max-page-size=16384` for all 4 supported ABIs.

---

## 2. OEM Battery Optimization & Background Execution

Android's WorkManager provides best-effort background processing. However, aggressive OEM task killers can suspend background workers when the app is minimized.

| OEM / Firmware                                   | Optimization Mechanism                             | Impact on Background Backup                                          | Mitigation & In-App User Guidance                                                                                       |
| :----------------------------------------------- | :------------------------------------------------- | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Samsung (OneUI)**                              | _Put unused apps to sleep_ & _Sleeping apps_ list  | May pause WorkManager jobs after 3-5 days of no foreground launch    | Prompt user to set app battery usage to **"Unrestricted"** in Settings > Apps > Telegram Gallery Backup > Battery.      |
| **Xiaomi / POCO (MIUI / HyperOS)**               | _MIUI Battery Saver_ & process freeze              | Frequently halts background network transfers after screen turns off | Prompt user to select **"No restrictions"** in Battery saver settings and enable **"Autostart"**.                       |
| **OnePlus / OPPO / Realme (OxygenOS / ColorOS)** | _Deep optimization_ & _Sleep standby optimization_ | Restricts network sockets during deep sleep                          | Guide user to disable _Deep optimization_ for this app. Foreground notification displayed during active transfers.      |
| **Google Pixel (AOSP)**                          | _Doze Mode_ & _App Standby Buckets_                | Standard Android behavior; WorkManager maintenance windows apply     | Standard WorkManager constraints with network connectivity listeners. Transfers resume automatically when device wakes. |

### Background Execution Disclosure (PRD Section 1.2)

The app never promises indefinite, uninterrupted background execution. In `DashboardScreen` and `SettingsScreen`, the app explicitly states:

> _"Background backups are best-effort under Android system and OEM battery restrictions. Transfers resume when the app is opened or when the device is charging on Wi-Fi."_

---

## 3. Storage Pressure & Low Free Space Mitigations

1. **Pre-Flight Free Space Verification:**
   Before initiating downloads or restoring media items, the app checks `StatFs.getAvailableBytes()`. If available storage is less than `requiredSizeBytes + 25MB` safety buffer, the operation is paused and an actionable notification is presented.
2. **Streaming Cursor & Batch Pagination:**
   MediaStore scanning uses paginated queries (chunks of 100 items with `LIMIT` and `OFFSET`) to avoid memory spikes when scanning large galleries (10,000+ items).
3. **App-Private Temp File Cleanup:**
   Decrypted files and temporary upload artifacts are created in `context.cacheDir` and purged immediately upon job completion or failure in a `finally` block using multi-pass zero-wiping (`TelegramCryptoService.secureWipe`).
