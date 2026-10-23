package com.telegramgallerybackup.app.bridge

import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.telegramgallerybackup.app.crypto.TelegramCryptoService
import com.telegramgallerybackup.app.telegram.TdLibService
import com.telegramgallerybackup.app.telegram.TelegramAuthState
import android.util.Log
import com.telegramgallerybackup.app.telegram.TelegramChannelManager
import com.telegramgallerybackup.app.telegram.TelegramMediaManager
import com.telegramgallerybackup.app.telegram.TelegramMetadataEnvelope
import com.telegramgallerybackup.app.telegram.TelegramPocRunner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Native React Native bridge module exposing:
 * - TDLib authentication and session management
 * - Idempotent, read-only channel discovery and explicit destination setup
 * - Hardware-accelerated cryptographic operations (AES-256-GCM and PBKDF2-HMAC-SHA256)
 * - Video playback launching and encrypted video preparation/cleanup
 */
class TelegramBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val tdLibService = TdLibService(reactContext)
    private val channelManager = TelegramChannelManager(tdLibService, reactContext)
    private val mediaManager = TelegramMediaManager(tdLibService)
    private val pocRunner = TelegramPocRunner(reactContext, tdLibService, channelManager, mediaManager)

    init {
        // Collect auth state changes and emit to React Native JS
        scope.launch {
            tdLibService.authState.collect { state ->
                val params = Arguments.createMap()
                state.toMap().forEach { (k, v) ->
                    when (v) {
                        is String -> params.putString(k, v)
                        is Number -> params.putDouble(k, v.toDouble())
                        is Boolean -> params.putBoolean(k, v)
                        null -> params.putNull(k)
                    }
                }
                sendEvent("onAuthStateChanged", params)
            }
        }
    }

    override fun getName(): String = "TelegramBridge"

    private fun sendEvent(eventName: String, params: Any?) {
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    private fun getCurrentUserId(): Long {
        val state = tdLibService.authState.value
        return if (state is TelegramAuthState.Ready) state.userId else 0L
    }

    @ReactMethod
    fun initialize(apiId: Double, apiHash: String, promise: Promise) {
        try {
            val id = if (apiId > 0) apiId.toInt() else TdLibService.DEFAULT_API_ID
            val hash = if (apiHash.isNotBlank()) apiHash else TdLibService.DEFAULT_API_HASH
            tdLibService.initialize(id, hash)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getAuthState(promise: Promise) {
        val state = tdLibService.authState.value
        val map = Arguments.createMap()
        state.toMap().forEach { (k, v) ->
            when (v) {
                is String -> map.putString(k, v)
                is Number -> map.putDouble(k, v.toDouble())
                is Boolean -> map.putBoolean(k, v)
                null -> map.putNull(k)
            }
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun sendPhoneNumber(phoneNumber: String, promise: Promise) {
        scope.launch {
            try {
                tdLibService.setPhoneNumber(phoneNumber)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("AUTH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun sendAuthCode(code: String, promise: Promise) {
        scope.launch {
            try {
                tdLibService.checkAuthCode(code)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("AUTH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun sendPassword(password: String, promise: Promise) {
        scope.launch {
            try {
                tdLibService.checkPassword(password)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("AUTH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun logOut(promise: Promise) {
        scope.launch {
            try {
                tdLibService.logOut()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("LOGOUT_ERROR", e.message, e)
            }
        }
    }

    // ==========================================
    // Cloud Storage Destination Management (Bug 4)
    // ==========================================

    /**
     * Read-only discovery and verification of existing channels.
     * NEVER creates a channel!
     */
    @ReactMethod
    fun refreshDestinations(promise: Promise) {
        scope.launch {
            try {
                val channels = channelManager.refreshDestinations(getCurrentUserId())
                if (channels != null) {
                    val map = Arguments.createMap().apply {
                        putString("photoChannelId", channels.photoChannelId.toString())
                        putString("photoChannelTitle", channels.photoChannelTitle)
                        putString("videoChannelId", channels.videoChannelId.toString())
                        putString("videoChannelTitle", channels.videoChannelTitle)
                        putBoolean("verified", channels.verified)

                        if (channels.photoStatus != null) {
                            val pMap = Arguments.createMap().apply {
                                putString("channelId", channels.photoStatus.channelId.toString())
                                putString("title", channels.photoStatus.title)
                                putString("state", channels.photoStatus.state.name)
                                putString("errorMessage", channels.photoStatus.errorMessage)
                            }
                            putMap("photoStatus", pMap)
                        }

                        if (channels.videoStatus != null) {
                            val vMap = Arguments.createMap().apply {
                                putString("channelId", channels.videoStatus.channelId.toString())
                                putString("title", channels.videoStatus.title)
                                putString("state", channels.videoStatus.state.name)
                                putString("errorMessage", channels.videoStatus.errorMessage)
                            }
                            putMap("videoStatus", vMap)
                        }
                    }
                    promise.resolve(map)
                } else {
                    promise.resolve(null)
                }
            } catch (e: Exception) {
                promise.reject("DESTINATION_REFRESH_ERROR", e.message, e)
            }
        }
    }

    /**
     * Explicit creation of a backup destination.
     */
    @ReactMethod
    fun createDestination(destinationType: String, promise: Promise) {
        scope.launch {
            try {
                val chat = channelManager.createDestination(destinationType, getCurrentUserId())
                val map = Arguments.createMap().apply {
                    putString("channelId", chat.id.toString())
                    putString("title", chat.title)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("DESTINATION_CREATE_ERROR", e.message, e)
            }
        }
    }

    /**
     * Explicit recreation of a deleted backup destination.
     */
    @ReactMethod
    fun recreateDestination(destinationType: String, promise: Promise) {
        scope.launch {
            try {
                val chat = channelManager.recreateDestination(destinationType, getCurrentUserId())
                val map = Arguments.createMap().apply {
                    putString("channelId", chat.id.toString())
                    putString("title", chat.title)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("DESTINATION_RECREATE_ERROR", e.message, e)
            }
        }
    }

    /**
     * Reconnects to an existing destination channel by ID.
     */
    @ReactMethod
    fun reconnectDestination(channelId: String, promise: Promise) {
        scope.launch {
            try {
                val cId = channelId.toLongOrNull() ?: 0L
                val verified = channelManager.reconnectDestination(cId)
                promise.resolve(verified)
            } catch (e: Exception) {
                promise.reject("RECONNECT_ERROR", e.message, e)
            }
        }
    }

    /**
     * Initial setup for backup channels. Idempotent: checks existing before creation.
     */
    @ReactMethod
    fun setupChannels(promise: Promise) {
        scope.launch {
            try {
                val channels = channelManager.getOrCreateBackupChannels(getCurrentUserId())
                val map = Arguments.createMap().apply {
                    putString("photoChannelId", channels.photoChannelId.toString())
                    putString("photoChannelTitle", channels.photoChannelTitle)
                    putString("videoChannelId", channels.videoChannelId.toString())
                    putString("videoChannelTitle", channels.videoChannelTitle)
                    putBoolean("verified", channels.verified)

                    if (channels.photoStatus != null) {
                        val pMap = Arguments.createMap().apply {
                            putString("channelId", channels.photoStatus.channelId.toString())
                            putString("title", channels.photoStatus.title)
                            putString("state", channels.photoStatus.state.name)
                            putString("errorMessage", channels.photoStatus.errorMessage)
                        }
                        putMap("photoStatus", pMap)
                    }

                    if (channels.videoStatus != null) {
                        val vMap = Arguments.createMap().apply {
                            putString("channelId", channels.videoStatus.channelId.toString())
                            putString("title", channels.videoStatus.title)
                            putString("state", channels.videoStatus.state.name)
                            putString("errorMessage", channels.videoStatus.errorMessage)
                        }
                        putMap("videoStatus", vMap)
                    }
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("CHANNEL_ERROR", e.message, e)
            }
        }
    }

    // ==========================================
    // Hardware-Accelerated Native Cryptography (Bug 1)
    // ==========================================

    @ReactMethod
    fun deriveMasterKey(recoveryKey: String, saltHex: String, iterations: Double, promise: Promise) {
        scope.launch {
            try {
                val iter = if (iterations > 0) iterations.toInt() else TelegramCryptoService.PBKDF2_ITERATIONS
                val keyBytes = TelegramCryptoService.deriveMasterKey(recoveryKey, saltHex, iter)
                val hex = bytesToHex(keyBytes)
                promise.resolve(hex)
            } catch (e: Exception) {
                promise.reject("KDF_ERROR", "Key derivation failed: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun createVerificationToken(masterKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val masterKey = hexToBytes(masterKeyHex)
                val tokenJson = TelegramCryptoService.createVerificationToken(masterKey)
                promise.resolve(tokenJson)
            } catch (e: Exception) {
                promise.reject("TOKEN_ERROR", "Failed to create verification token: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun verifyRecoveryKey(recoveryKey: String, saltHex: String, verificationTokenJson: String, promise: Promise) {
        scope.launch {
            try {
                val isValid = TelegramCryptoService.verifyRecoveryKey(recoveryKey, saltHex, verificationTokenJson)
                promise.resolve(isValid)
            } catch (e: Exception) {
                promise.reject("VERIFY_ERROR", "Passphrase verification failed: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun encryptPayload(plaintextBase64: String, keyHex: String, promise: Promise) {
        scope.launch {
            try {
                val plaintext = Base64.decode(plaintextBase64, Base64.NO_WRAP)
                val key = hexToBytes(keyHex)
                val enc = TelegramCryptoService.encryptAesGcm(plaintext, key)
                val map = Arguments.createMap().apply {
                    putString("ciphertextBase64", Base64.encodeToString(enc.ciphertext, Base64.NO_WRAP))
                    putString("ivBase64", enc.ivBase64)
                    putString("tagBase64", enc.tagBase64)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("ENCRYPT_ERROR", "Encryption failed: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun decryptPayload(ciphertextBase64: String, keyHex: String, ivBase64: String, tagBase64: String, promise: Promise) {
        scope.launch {
            try {
                val ciphertext = Base64.decode(ciphertextBase64, Base64.NO_WRAP)
                val key = hexToBytes(keyHex)
                val decrypted = TelegramCryptoService.decryptAesGcm(ciphertext, key, ivBase64, tagBase64)
                val plaintextBase64 = Base64.encodeToString(decrypted, Base64.NO_WRAP)
                promise.resolve(plaintextBase64)
            } catch (e: Exception) {
                promise.reject("DECRYPT_ERROR", "Decryption failed: ${e.message}", e)
            }
        }
    }

    // ==========================================
    // Keystore-Backed Secure Key Persistence (Bug 1)
    // ==========================================

    @ReactMethod
    fun storeSecureMasterKey(masterKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                if (masterKeyHex.isBlank() || masterKeyHex.length != 64) {
                    promise.reject("INVALID_KEY", "Invalid 256-bit master key hex.")
                    return@launch
                }
                val success = TelegramCryptoService.storeMasterKeyProtected(reactApplicationContext, masterKeyHex)
                promise.resolve(success)
            } catch (e: Exception) {
                promise.reject("KEYSTORE_ERROR", "Failed to store master key securely: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun loadSecureMasterKey(promise: Promise) {
        scope.launch {
            try {
                val keyHex = TelegramCryptoService.loadMasterKeyProtected(reactApplicationContext)
                promise.resolve(keyHex)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }
    }

    @ReactMethod
    fun clearSecureMasterKey(promise: Promise) {
        scope.launch {
            try {
                val success = TelegramCryptoService.clearMasterKeyProtected(reactApplicationContext)
                promise.resolve(success)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }
    }

    @ReactMethod
    fun isSecureStorageAvailable(promise: Promise) {
        scope.launch {
            val available = TelegramCryptoService.isKeystoreAvailable()
            promise.resolve(available)
        }
    }

    // ==========================================
    // Media Playback and Decryption Pipeline (Bug 3)
    // ==========================================

    @ReactMethod
    fun playVideo(uriString: String, promise: Promise) {
        try {
            val uri = Uri.parse(uriString)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "video/*")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val pm = reactApplicationContext.packageManager
            if (intent.resolveActivity(pm) != null) {
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.reject("NO_PLAYER", "No video player application found to play this video.")
            }
        } catch (e: Exception) {
            promise.reject("PLAY_ERROR", "Failed to launch video player: ${e.message}", e)
        }
    }

    @ReactMethod
    fun prepareCloudVideo(fileId: Double, isEncrypted: Boolean, envelopeJson: String, masterKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val fId = fileId.toInt()
                val downloadedFile = mediaManager.downloadMediaFile(fId)
                if (downloadedFile == null || !downloadedFile.exists()) {
                    promise.reject("DOWNLOAD_FAILED", "Failed to download video file from Telegram.")
                    return@launch
                }

                if (!isEncrypted) {
                    val map = Arguments.createMap().apply {
                        putString("localUri", Uri.fromFile(downloadedFile).toString())
                        putString("tempFilePath", downloadedFile.absolutePath)
                        putBoolean("isTemporary", false)
                    }
                    promise.resolve(map)
                    return@launch
                }

                // Disk space check before decrypting to temp file
                val requiredSpace = downloadedFile.length() + 50 * 1024 * 1024L
                if (reactApplicationContext.cacheDir.usableSpace < requiredSpace) {
                    promise.reject("INSUFFICIENT_STORAGE", "Device storage is low. Please free up space.")
                    return@launch
                }

                // Read first 16 bytes to detect if file is already unencrypted without reading full payload
                val header = ByteArray(16)
                java.io.FileInputStream(downloadedFile).use { it.read(header) }
                if (TelegramCryptoService.isPlaintextMedia(header)) {
                    val map = Arguments.createMap().apply {
                        putString("localUri", Uri.fromFile(downloadedFile).toString())
                        putString("tempFilePath", downloadedFile.absolutePath)
                        putBoolean("isTemporary", false)
                        putBoolean("wasPlaintext", true)
                    }
                    promise.resolve(map)
                    return@launch
                }

                // Decrypt encrypted video payload using streaming 64KB bounded buffer
                val envelopeObj = JSONObject(envelopeJson)
                val ivBase64 = envelopeObj.getString("iv")
                val tagBase64 = envelopeObj.getString("tag")
                val encryptedDek = envelopeObj.getString("encryptedDek")
                val dekIv = envelopeObj.getString("dekIv")
                val dekTag = envelopeObj.getString("dekTag")

                val masterKey = hexToBytes(masterKeyHex)
                val dekCiphertext = Base64.decode(encryptedDek, Base64.NO_WRAP)
                val dek = TelegramCryptoService.decryptAesGcm(dekCiphertext, masterKey, dekIv, dekTag)

                val cacheDir = File(reactApplicationContext.cacheDir, "tgcloud_video_playback")
                if (!cacheDir.exists()) cacheDir.mkdirs()
                val tempDecryptedFile = File(cacheDir, "decrypted_${System.currentTimeMillis()}.mp4")

                TelegramCryptoService.decryptMediaFile(downloadedFile, tempDecryptedFile, dek, ivBase64, tagBase64)

                val map = Arguments.createMap().apply {
                    putString("localUri", Uri.fromFile(tempDecryptedFile).toString())
                    putString("tempFilePath", tempDecryptedFile.absolutePath)
                    putBoolean("isTemporary", true)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("PREPARE_ERROR", "Failed to prepare video for playback: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun prepareCloudPhoto(fileId: Double, isEncrypted: Boolean, envelopeJson: String, masterKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val fId = fileId.toInt()
                val downloadedFile = mediaManager.downloadMediaFile(fId)
                if (downloadedFile == null || !downloadedFile.exists()) {
                    promise.reject("DOWNLOAD_FAILED", "Failed to download photo file from Telegram.")
                    return@launch
                }

                if (!isEncrypted) {
                    val map = Arguments.createMap().apply {
                        putString("localUri", Uri.fromFile(downloadedFile).toString())
                        putString("tempFilePath", downloadedFile.absolutePath)
                        putBoolean("isTemporary", false)
                    }
                    promise.resolve(map)
                    return@launch
                }

                // Disk space check before decrypting to temp file
                val requiredSpace = downloadedFile.length() + 20 * 1024 * 1024L
                if (reactApplicationContext.cacheDir.usableSpace < requiredSpace) {
                    promise.reject("INSUFFICIENT_STORAGE", "Device storage is low. Please free up space.")
                    return@launch
                }

                // Read first 16 bytes to detect if file is already unencrypted
                val header = ByteArray(16)
                java.io.FileInputStream(downloadedFile).use { it.read(header) }
                if (TelegramCryptoService.isPlaintextMedia(header)) {
                    val map = Arguments.createMap().apply {
                        putString("localUri", Uri.fromFile(downloadedFile).toString())
                        putString("tempFilePath", downloadedFile.absolutePath)
                        putBoolean("isTemporary", false)
                        putBoolean("wasPlaintext", true)
                    }
                    promise.resolve(map)
                    return@launch
                }

                // Decrypt encrypted photo payload using streaming 64KB bounded buffer
                val envelopeObj = JSONObject(envelopeJson)
                val ivBase64 = envelopeObj.getString("iv")
                val tagBase64 = envelopeObj.getString("tag")
                val encryptedDek = envelopeObj.getString("encryptedDek")
                val dekIv = envelopeObj.getString("dekIv")
                val dekTag = envelopeObj.getString("dekTag")

                val masterKey = hexToBytes(masterKeyHex)
                val dekCiphertext = Base64.decode(encryptedDek, Base64.NO_WRAP)
                val dek = TelegramCryptoService.decryptAesGcm(dekCiphertext, masterKey, dekIv, dekTag)

                val cacheDir = File(reactApplicationContext.cacheDir, "tgcloud_photo_playback")
                if (!cacheDir.exists()) cacheDir.mkdirs()
                val tempDecryptedFile = File(cacheDir, "decrypted_${System.currentTimeMillis()}.jpg")

                TelegramCryptoService.decryptMediaFile(downloadedFile, tempDecryptedFile, dek, ivBase64, tagBase64)

                val map = Arguments.createMap().apply {
                    putString("localUri", Uri.fromFile(tempDecryptedFile).toString())
                    putString("tempFilePath", tempDecryptedFile.absolutePath)
                    putBoolean("isTemporary", true)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("PREPARE_ERROR", "Failed to prepare photo for viewing: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun cleanupTempMedia(filePath: String, promise: Promise) {
        scope.launch {
            try {
                if (filePath.isNotBlank()) {
                    val file = File(filePath)
                    if (file.exists() && (file.absolutePath.contains("tgcloud_video_playback") || file.absolutePath.contains("tgcloud_photo_playback"))) {
                        TelegramCryptoService.secureWipe(file)
                    }
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }
    }

    /**
     * Uploads media (photo or video) to the specified Telegram channel with versioned metadata caption.
     * When isEncrypted is true, encrypts the file locally with AES-256-GCM before sending ciphertext to Telegram.
     * Uses streaming bounded buffers and disk space checks to prevent memory exhaustion and crashes.
     */
    @ReactMethod
    fun uploadMedia(
        chatId: String,
        uriString: String,
        mediaType: String,
        metadataJson: String,
        isEncrypted: Boolean,
        masterKeyHex: String,
        promise: Promise
    ) {
        scope.launch {
            var tempRawSourceFile: File? = null
            var tempEncryptedFile: File? = null
            try {
                val cId = chatId.toLong()
                val metaObj = JSONObject(metadataJson)
                val mediaId = metaObj.optString("mediaId", "media_${System.currentTimeMillis()}")
                val originalName = metaObj.optString("originalName", "media_upload")
                val relativePath = metaObj.optString("relativePath", "")
                val mimeType = metaObj.optString("mimeType", if (mediaType == "video") "video/mp4" else "image/jpeg")
                val modifiedAtMs = metaObj.optLong("modifiedAtMs", System.currentTimeMillis())
                val contentHash = if (metaObj.has("contentHash") && !metaObj.isNull("contentHash")) metaObj.getString("contentHash") else null

                // Disk space check before allocating temporary files
                val cacheDir = File(reactApplicationContext.cacheDir, "tgcloud_upload")
                if (!cacheDir.exists()) cacheDir.mkdirs()
                val estimatedSize = metaObj.optLong("sizeBytes", 10 * 1024 * 1024L)
                val requiredSpace = estimatedSize * 2 + 50 * 1024 * 1024L
                if (cacheDir.usableSpace < requiredSpace) {
                    throw IllegalStateException("Insufficient device storage for upload: requires at least ${requiredSpace / (1024 * 1024)}MB free space.")
                }

                // Resolve source file to local filesystem for reading
                val uploadFile: File
                if (uriString.startsWith("content://")) {
                    val contentUri = Uri.parse(uriString)
                    val cleanName = originalName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                    val temp = File(cacheDir, "upload_raw_${System.currentTimeMillis()}_$cleanName")
                    val inputStream = reactApplicationContext.contentResolver.openInputStream(contentUri)
                        ?: throw IllegalStateException("Could not open content stream for $uriString")
                    val buffer = ByteArray(TelegramCryptoService.BUFFER_SIZE)
                    inputStream.use { input ->
                        FileOutputStream(temp).use { output ->
                            var read: Int
                            while (input.read(buffer).also { read = it } != -1) {
                                output.write(buffer, 0, read)
                            }
                        }
                    }
                    tempRawSourceFile = temp
                    uploadFile = temp
                } else {
                    val filePath = if (uriString.startsWith("file://")) Uri.parse(uriString).path ?: "" else uriString
                    val file = File(filePath)
                    if (!file.exists()) {
                        throw IllegalStateException("File does not exist: $filePath")
                    }
                    uploadFile = file
                }

                val finalFileToUpload: File
                val envelope: TelegramMetadataEnvelope

                if (isEncrypted) {
                    if (masterKeyHex.isBlank() || masterKeyHex.length != 64) {
                        throw IllegalStateException("Cannot upload encrypted media: valid 256-bit master key is required. Aborting to prevent plaintext leak.")
                    }

                    // 1. Generate fresh random 256-bit DEK
                    val dek = ByteArray(32)
                    java.security.SecureRandom().nextBytes(dek)

                    // 2. Encrypt media content with DEK using streaming 64KB bounded buffers
                    val encFile = File(cacheDir, "upload_enc_${System.currentTimeMillis()}.bin")
                    val mediaEnc = TelegramCryptoService.encryptMediaFile(uploadFile, encFile, dek)
                    tempEncryptedFile = encFile

                    // 3. Encrypt sensitive metadata JSON with DEK
                    val sensitiveMetaJson = JSONObject().apply {
                        put("originalName", originalName)
                        put("relativePath", relativePath)
                        put("mimeType", mimeType)
                        put("sizeBytes", uploadFile.length())
                        put("modifiedAtMs", modifiedAtMs)
                        if (contentHash != null) put("contentHash", contentHash)
                    }.toString()
                    val metaEnc = TelegramCryptoService.encryptAesGcm(sensitiveMetaJson.toByteArray(Charsets.UTF_8), dek)

                    // 4. Encrypt DEK with Master Key
                    val masterKey = hexToBytes(masterKeyHex)
                    val dekEnc = TelegramCryptoService.encryptAesGcm(dek, masterKey)

                    // 5. Build EncryptedItemEnvelope JSON
                    val saltHex = metaObj.optString("saltHex", "")
                    val verificationToken = metaObj.optString("verificationToken", "")
                    val encJson = JSONObject().apply {
                        put("alg", "AES-256-GCM")
                        put("keyVersion", 1)
                        put("iv", mediaEnc.ivBase64)
                        put("tag", mediaEnc.tagBase64)
                        put("encryptedDek", java.util.Base64.getEncoder().encodeToString(dekEnc.ciphertext))
                        put("dekIv", dekEnc.ivBase64)
                        put("dekTag", dekEnc.tagBase64)
                        put("encryptedMeta", java.util.Base64.getEncoder().encodeToString(metaEnc.ciphertext))
                        put("metaIv", metaEnc.ivBase64)
                        put("metaTag", metaEnc.tagBase64)
                        if (saltHex.isNotBlank()) put("salt", saltHex)
                        if (verificationToken.isNotBlank()) put("verificationToken", verificationToken)
                    }.toString()

                    // 6. Build outer Telegram metadata envelope with masked sensitive fields
                    envelope = TelegramMetadataEnvelope(
                        schemaVersion = TelegramMetadataEnvelope.CURRENT_SCHEMA_VERSION,
                        app = TelegramMetadataEnvelope.APP_IDENTIFIER,
                        mediaId = mediaId,
                        mediaType = mediaType,
                        originalName = "encrypted.bin",
                        relativePath = "",
                        mimeType = "application/octet-stream",
                        sizeBytes = encFile.length(),
                        modifiedAtMs = 0L,
                        contentHash = null,
                        encryptionEnvelope = encJson
                    )
                    finalFileToUpload = encFile
                } else {
                    // Plaintext upload: original media with versioned metadata
                    envelope = TelegramMetadataEnvelope(
                        schemaVersion = TelegramMetadataEnvelope.CURRENT_SCHEMA_VERSION,
                        app = TelegramMetadataEnvelope.APP_IDENTIFIER,
                        mediaId = mediaId,
                        mediaType = mediaType,
                        originalName = originalName,
                        relativePath = relativePath,
                        mimeType = mimeType,
                        sizeBytes = uploadFile.length(),
                        modifiedAtMs = modifiedAtMs,
                        contentHash = contentHash,
                        encryptionEnvelope = null
                    )
                    finalFileToUpload = uploadFile
                }

                // Safe video metadata extraction
                var videoDurationSec = 0
                var videoWidth = 0
                var videoHeight = 0
                if (mediaType == "video") {
                    try {
                        val retriever = android.media.MediaMetadataRetriever()
                        retriever.setDataSource(uploadFile.absolutePath)
                        val durationStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                        val wStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                        val hStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                        videoDurationSec = (durationStr?.toLongOrNull() ?: 0L).toInt() / 1000
                        videoWidth = wStr?.toIntOrNull() ?: 0
                        videoHeight = hStr?.toIntOrNull() ?: 0
                        retriever.release()
                    } catch (_: Exception) {}
                }

                val result = if (mediaType == "video" && !isEncrypted) {
                    mediaManager.uploadVideo(cId, finalFileToUpload, envelope, videoDurationSec, videoWidth, videoHeight)
                } else {
                    mediaManager.uploadPhoto(cId, finalFileToUpload, envelope)
                }

                val map = Arguments.createMap().apply {
                    putString("messageId", result.messageId.toString())
                    putString("channelId", result.chatId.toString())
                    putInt("fileId", result.fileId)
                    putString("contentHash", result.metadata.contentHash)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e("TelegramBridge", "uploadMedia failed: ${e.message}", e)
                val msg = e.message ?: "Upload failed"
                if (msg.contains("FLOOD_WAIT", ignoreCase = true) || msg.contains("429")) {
                    promise.reject("RATE_LIMIT", msg, e)
                } else {
                    promise.reject("UPLOAD_ERROR", "Failed to upload media to Telegram: ${e.message}", e)
                }
            } finally {
                tempRawSourceFile?.let {
                    try {
                        if (it.exists()) it.delete()
                    } catch (_: Exception) {}
                }
                tempEncryptedFile?.let {
                    try {
                        TelegramCryptoService.secureWipe(it)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    /**
     * Deletes specified messages from Telegram cloud channel.
     */
    @ReactMethod
    fun deleteMessages(chatId: String, messageIds: com.facebook.react.bridge.ReadableArray, promise: Promise) {
        scope.launch {
            try {
                val cId = chatId.toLong()
                val idList = mutableListOf<Long>()
                for (i in 0 until messageIds.size()) {
                    val idStr = messageIds.getString(i)
                    val id = idStr?.toLongOrNull()
                    if (id != null) {
                        idList.add(id)
                    }
                }
                val success = mediaManager.deleteMessages(cId, idList)
                promise.resolve(success)
            } catch (e: Exception) {
                promise.reject("DELETE_ERROR", "Failed to delete messages from Telegram: ${e.message}", e)
            }
        }
    }

    // ==========================================
    // PoC Runner and Channel History
    // ==========================================

    @ReactMethod
    fun runPocTest(promise: Promise) {
        scope.launch {
            try {
                val result = pocRunner.runPoc()
                val map = Arguments.createMap().apply {
                    putBoolean("success", result.success)
                    putInt("totalSteps", result.totalSteps)
                    putInt("passedSteps", result.passedSteps)

                    val stepsArray = Arguments.createArray()
                    result.steps.forEach { step ->
                        val stepMap = Arguments.createMap().apply {
                            putInt("step", step.step)
                            putString("name", step.name)
                            putBoolean("passed", step.passed)
                            putString("message", step.message)
                            putDouble("durationMs", step.durationMs.toDouble())
                        }
                        stepsArray.pushMap(stepMap)
                    }
                    putArray("steps", stepsArray)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("POC_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getChannelHistory(chatId: String, limit: Double, fromMessageId: String, promise: Promise) {
        scope.launch {
            try {
                val cId = chatId.toLong()
                val fId = fromMessageId.toLongOrNull() ?: 0L
                val items = mediaManager.getChannelHistory(cId, fId, limit.toInt())
                val array = Arguments.createArray()
                items.forEach { item ->
                    val itemMap = Arguments.createMap().apply {
                        putString("messageId", item.messageId.toString())
                        putString("chatId", item.chatId.toString())
                        putInt("fileId", item.fileId)
                        putString("mediaId", item.metadata.mediaId)
                        putString("mediaType", item.metadata.mediaType)
                        putString("originalName", item.metadata.originalName)
                        putString("relativePath", item.metadata.relativePath)
                        putDouble("sizeBytes", item.metadata.sizeBytes.toDouble())
                        putDouble("modifiedAtMs", item.metadata.modifiedAtMs.toDouble())
                        putString("contentHash", item.metadata.contentHash)
                        putInt("date", item.date)
                        if (item.metadata.encryptionEnvelope != null) {
                            putString("encryptionEnvelope", item.metadata.encryptionEnvelope)
                        }
                    }
                    array.pushMap(itemMap)
                }
                promise.resolve(array)
            } catch (e: Exception) {
                promise.reject("HISTORY_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun openChatInTelegram(chatId: String, promise: Promise) {
        try {
            val rawId = chatId.replace("-100", "").replace("-", "")
            val tgUri = Uri.parse("tg://openmessage?chat_id=$chatId")
            val intent = Intent(Intent.ACTION_VIEW, tgUri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val pm = reactApplicationContext.packageManager
            if (intent.resolveActivity(pm) != null) {
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                val webUri = Uri.parse("https://t.me/c/$rawId")
                val webIntent = Intent(Intent.ACTION_VIEW, webUri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(webIntent)
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("OPEN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required for RN NativeEventEmitter
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val hexChars = "0123456789abcdef"
        val result = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val i = b.toInt() and 0xff
            result.append(hexChars[i shr 4])
            result.append(hexChars[i and 0x0f])
        }
        return result.toString()
    }

    private fun hexToBytes(hex: String): ByteArray {
        val len = hex.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = (
                (Character.digit(hex[i], 16) shl 4) +
                Character.digit(hex[i + 1], 16)
            ).toByte()
            i += 2
        }
        return data
    }
}
