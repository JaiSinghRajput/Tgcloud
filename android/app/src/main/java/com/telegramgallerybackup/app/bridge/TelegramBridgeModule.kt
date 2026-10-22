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

                // Decrypt encrypted video payload
                val envelopeObj = JSONObject(envelopeJson)
                val ivBase64 = envelopeObj.getString("iv")
                val tagBase64 = envelopeObj.getString("tag")
                val encryptedDek = envelopeObj.getString("encryptedDek")
                val dekIv = envelopeObj.getString("dekIv")
                val dekTag = envelopeObj.getString("dekTag")

                val masterKey = hexToBytes(masterKeyHex)
                val dekCiphertext = Base64.decode(encryptedDek, Base64.NO_WRAP)
                val dek = TelegramCryptoService.decryptAesGcm(dekCiphertext, masterKey, dekIv, dekTag)

                val ciphertext = downloadedFile.readBytes()
                val decrypted = TelegramCryptoService.decryptAesGcm(ciphertext, dek, ivBase64, tagBase64)

                val cacheDir = File(reactApplicationContext.cacheDir, "tgcloud_video_playback")
                if (!cacheDir.exists()) cacheDir.mkdirs()
                val tempDecryptedFile = File(cacheDir, "decrypted_${System.currentTimeMillis()}.mp4")
                FileOutputStream(tempDecryptedFile).use { it.write(decrypted) }

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
    fun cleanupTempMedia(filePath: String, promise: Promise) {
        scope.launch {
            try {
                if (filePath.isNotBlank()) {
                    val file = File(filePath)
                    if (file.exists() && file.absolutePath.contains("tgcloud_video_playback")) {
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
     */
    @ReactMethod
    fun uploadMedia(
        chatId: String,
        uriString: String,
        mediaType: String,
        metadataJson: String,
        promise: Promise
    ) {
        scope.launch {
            var tempFileToDelete: File? = null
            try {
                val cId = chatId.toLong()
                val metaObj = JSONObject(metadataJson)
                val mediaId = metaObj.optString("mediaId", "media_${System.currentTimeMillis()}")
                val originalName = metaObj.optString("originalName", "media_upload")
                val relativePath = metaObj.optString("relativePath", "")
                val mimeType = metaObj.optString("mimeType", if (mediaType == "video") "video/mp4" else "image/jpeg")
                val sizeBytes = metaObj.optLong("sizeBytes", 0L)
                val modifiedAtMs = metaObj.optLong("modifiedAtMs", System.currentTimeMillis())
                val contentHash = if (metaObj.has("contentHash") && !metaObj.isNull("contentHash")) metaObj.getString("contentHash") else null
                val encryptionEnvelope = if (metaObj.has("encryptionEnvelope") && !metaObj.isNull("encryptionEnvelope")) metaObj.getString("encryptionEnvelope") else null

                val envelope = TelegramMetadataEnvelope(
                    schemaVersion = TelegramMetadataEnvelope.CURRENT_SCHEMA_VERSION,
                    app = TelegramMetadataEnvelope.APP_IDENTIFIER,
                    mediaId = mediaId,
                    mediaType = mediaType,
                    originalName = originalName,
                    relativePath = relativePath,
                    mimeType = mimeType,
                    sizeBytes = sizeBytes,
                    modifiedAtMs = modifiedAtMs,
                    contentHash = contentHash,
                    encryptionEnvelope = encryptionEnvelope
                )

                // Resolve source file to real filesystem path for TDLib
                val uploadFile: File
                if (uriString.startsWith("content://")) {
                    val contentUri = Uri.parse(uriString)
                    val cacheDir = File(reactApplicationContext.cacheDir, "tgcloud_upload")
                    if (!cacheDir.exists()) cacheDir.mkdirs()
                    val cleanName = originalName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                    val temp = File(cacheDir, "upload_${System.currentTimeMillis()}_$cleanName")
                    val inputStream = reactApplicationContext.contentResolver.openInputStream(contentUri)
                        ?: throw IllegalStateException("Could not open content stream for $uriString")
                    inputStream.use { input ->
                        FileOutputStream(temp).use { output ->
                            input.copyTo(output)
                        }
                    }
                    tempFileToDelete = temp
                    uploadFile = temp
                } else {
                    val filePath = if (uriString.startsWith("file://")) Uri.parse(uriString).path ?: "" else uriString
                    val file = File(filePath)
                    if (!file.exists()) {
                        throw IllegalStateException("File does not exist: $filePath")
                    }
                    uploadFile = file
                }

                val result = if (mediaType == "video") {
                    mediaManager.uploadVideo(cId, uploadFile, envelope)
                } else {
                    mediaManager.uploadPhoto(cId, uploadFile, envelope)
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
                promise.reject("UPLOAD_ERROR", "Failed to upload media to Telegram: ${e.message}", e)
            } finally {
                tempFileToDelete?.let {
                    try {
                        if (it.exists()) it.delete()
                    } catch (_: Exception) {}
                }
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
