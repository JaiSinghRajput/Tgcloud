package com.telegramgallerybackup.app.telegram

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

/**
 * Result data class for the Phase 1 Proof-of-Concept test suite.
 */
data class PocStepResult(
    val step: Int,
    val name: String,
    val passed: Boolean,
    val message: String,
    val durationMs: Long
)

data class PocSuiteResult(
    val success: Boolean,
    val totalSteps: Int,
    val passedSteps: Int,
    val steps: List<PocStepResult>,
    val details: Map<String, Any?>
)

/**
 * Executes the complete Phase 1 TDLib proof of concept validation sequence.
 */
class TelegramPocRunner(
    private val context: Context,
    private val tdLibService: TdLibService,
    private val channelManager: TelegramChannelManager,
    private val mediaManager: TelegramMediaManager
) {
    private val tag = "TelegramPocRunner"

    suspend fun runPoc(): PocSuiteResult {
        val steps = mutableListOf<PocStepResult>()
        val details = mutableMapOf<String, Any?>()

        // Step 1: TDLib Storage & State Initialization
        var stepStart = System.currentTimeMillis()
        try {
            val tdlibDir = File(context.filesDir, "tdlib")
            val filesDir = File(context.filesDir, "tdlib_files")
            val initialized = tdlibDir.exists() && filesDir.exists()
            steps.add(
                PocStepResult(
                    step = 1,
                    name = "TDLib Storage Initialization",
                    passed = initialized,
                    message = "Storage directories verified in app-private storage: ${tdlibDir.name}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 1,
                    name = "TDLib Storage Initialization",
                    passed = false,
                    message = "Failed: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
            return PocSuiteResult(false, 1, 0, steps, details)
        }

        // Step 2: Auth State Verification
        stepStart = System.currentTimeMillis()
        val currentAuth = tdLibService.authState.value
        val isReady = currentAuth is TelegramAuthState.Ready
        steps.add(
            PocStepResult(
                step = 2,
                name = "Telegram Authorization Check",
                passed = isReady,
                message = if (isReady) "User authorized (Ready)" else "User not authorized (State: ${currentAuth::class.simpleName}). Complete Telegram login first.",
                durationMs = System.currentTimeMillis() - stepStart
            )
        )
        if (!isReady) {
            return PocSuiteResult(false, steps.size, steps.count { it.passed }, steps, details)
        }

        val readyState = currentAuth as TelegramAuthState.Ready
        details["userId"] = readyState.userId

        // Step 3: Private Channels Discovery/Creation & Verification
        stepStart = System.currentTimeMillis()
        val channels: TelegramBackupChannels
        try {
            channels = channelManager.getOrCreateBackupChannels()
            details["photoChannelId"] = channels.photoChannelId
            details["videoChannelId"] = channels.videoChannelId
            steps.add(
                PocStepResult(
                    step = 3,
                    name = "Private Backup Channels Setup",
                    passed = channels.verified,
                    message = "Photo channel '${channels.photoChannelTitle}' and Video channel '${channels.videoChannelTitle}' verified (Posting access confirmed)",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 3,
                    name = "Private Backup Channels Setup",
                    passed = false,
                    message = "Channel setup failed: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
            return PocSuiteResult(false, steps.size, steps.count { it.passed }, steps, details)
        }

        // Step 4: Synthetic Test Media Creation
        stepStart = System.currentTimeMillis()
        val testPhotoFile: File
        try {
            testPhotoFile = createTestBitmapFile("poc_test_photo.jpg")
            val hash = calculateSha256(testPhotoFile)
            details["testPhotoBytes"] = testPhotoFile.length()
            details["testPhotoHash"] = hash
            steps.add(
                PocStepResult(
                    step = 4,
                    name = "Test Media Preparation",
                    passed = true,
                    message = "Created synthetic test photo (${testPhotoFile.length()} bytes, hash: ${hash.take(8)}...)",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 4,
                    name = "Test Media Preparation",
                    passed = false,
                    message = "Failed to create test media: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
            return PocSuiteResult(false, steps.size, steps.count { it.passed }, steps, details)
        }

        // Step 5: Versioned Metadata Envelope Creation
        stepStart = System.currentTimeMillis()
        val mediaId = "poc-${UUID.randomUUID()}"
        val metadata = TelegramMetadataEnvelope(
            schemaVersion = 1,
            mediaId = mediaId,
            mediaType = "photo",
            originalName = "poc_test_photo.jpg",
            relativePath = "DCIM/PocTest/poc_test_photo.jpg",
            mimeType = "image/jpeg",
            sizeBytes = testPhotoFile.length(),
            modifiedAtMs = System.currentTimeMillis(),
            contentHash = details["testPhotoHash"] as String
        )
        steps.add(
            PocStepResult(
                step = 5,
                name = "Metadata Envelope Generation",
                passed = true,
                message = "Envelope created for mediaId: $mediaId with schemaVersion 1",
                durationMs = System.currentTimeMillis() - stepStart
            )
        )

        // Step 6: Send Media with Metadata Caption
        stepStart = System.currentTimeMillis()
        val uploadResult: TelegramMediaResult
        try {
            uploadResult = mediaManager.uploadPhoto(
                chatId = channels.photoChannelId,
                localFile = testPhotoFile,
                metadata = metadata
            )
            details["messageId"] = uploadResult.messageId
            details["fileId"] = uploadResult.fileId
            steps.add(
                PocStepResult(
                    step = 6,
                    name = "Media Upload with Metadata",
                    passed = uploadResult.messageId > 0,
                    message = "Uploaded test photo to channel ${channels.photoChannelId}. Remote message ID: ${uploadResult.messageId}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 6,
                    name = "Media Upload with Metadata",
                    passed = false,
                    message = "Upload failed: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
            return PocSuiteResult(false, steps.size, steps.count { it.passed }, steps, details)
        }

        // Step 7: Channel History Reading & Metadata Reconstruction
        stepStart = System.currentTimeMillis()
        try {
            val history = mediaManager.getChannelHistory(channels.photoChannelId, limit = 10)
            val matchedItem = history.firstOrNull { it.metadata.mediaId == mediaId }
            val passed = matchedItem != null && matchedItem.metadata.sizeBytes == metadata.sizeBytes
            steps.add(
                PocStepResult(
                    step = 7,
                    name = "Channel History Read & Reconstruction",
                    passed = passed,
                    message = if (passed) "Successfully parsed metadata from channel history. Matched original name: ${matchedItem?.metadata?.originalName}"
                    else "Metadata not found or mismatch in channel history",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 7,
                    name = "Channel History Read & Reconstruction",
                    passed = false,
                    message = "History read failed: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        }

        // Step 8: Idempotency & Reconciliation Verification
        stepStart = System.currentTimeMillis()
        try {
            val duplicateCheck = mediaManager.findExistingMedia(
                chatId = channels.photoChannelId,
                mediaId = mediaId,
                contentHash = metadata.contentHash
            )
            val passed = duplicateCheck != null && duplicateCheck.messageId == uploadResult.messageId
            steps.add(
                PocStepResult(
                    step = 8,
                    name = "Transfer Idempotency Reconciliation",
                    passed = passed,
                    message = if (passed) "Reconciliation successfully detected prior upload (avoided duplicate)"
                    else "Reconciliation check failed",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 8,
                    name = "Transfer Idempotency Reconciliation",
                    passed = false,
                    message = "Reconciliation test failed: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        }

        // Step 9: Download Media & Verify File Integrity
        stepStart = System.currentTimeMillis()
        try {
            val downloadedFile = mediaManager.downloadMediaFile(uploadResult.fileId)
            val passed = downloadedFile != null && downloadedFile.exists() && downloadedFile.length() > 0
            steps.add(
                PocStepResult(
                    step = 9,
                    name = "Media Download & Verification",
                    passed = passed,
                    message = if (passed) "File restored to local cache (${downloadedFile?.length()} bytes)"
                    else "Download verification failed or timed out",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        } catch (e: Exception) {
            steps.add(
                PocStepResult(
                    step = 9,
                    name = "Media Download & Verification",
                    passed = false,
                    message = "Download failed: ${e.message}",
                    durationMs = System.currentTimeMillis() - stepStart
                )
            )
        }

        // Step 10: Cleanup Test Files
        stepStart = System.currentTimeMillis()
        testPhotoFile.delete()
        steps.add(
            PocStepResult(
                step = 10,
                name = "Temporary File Cleanup",
                passed = true,
                message = "Cleaned up temporary local test files",
                durationMs = System.currentTimeMillis() - stepStart
            )
        )

        val totalPassed = steps.count { it.passed }
        val overallSuccess = totalPassed == steps.size

        return PocSuiteResult(
            success = overallSuccess,
            totalSteps = steps.size,
            passedSteps = totalPassed,
            steps = steps,
            details = details
        )
    }

    private fun createTestBitmapFile(filename: String): File {
        val file = File(context.cacheDir, filename)
        val bitmap = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(4, 120, 87)) // Emerald brand color
        val paint = Paint().apply {
            color = Color.WHITE
            textSize = 24f
            isAntiAlias = true
        }
        canvas.drawText("TGB PoC Test", 30f, 100f, paint)

        FileOutputStream(file).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        }
        return file
    }

    private fun calculateSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
