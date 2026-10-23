package com.telegramgallerybackup.app.telegram

import android.util.Log
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.drinkless.tdlib.TdApi
import java.io.File

/**
 * Result representing a successfully uploaded or restored Telegram media item.
 */
data class TelegramMediaResult(
    val messageId: Long,
    val chatId: Long,
    val fileId: Int,
    val remoteFileId: String?,
    val metadata: TelegramMetadataEnvelope,
    val date: Int
)

/**
 * Manages media uploads with versioned metadata envelopes,
 * channel history pagination, file downloading, and duplicate reconciliation.
 */
class TelegramMediaManager(private val tdLibService: TdLibService) {

    private val tag = "TelegramMediaManager"

    /**
     * Uploads a photo to the specified channel with an attached metadata envelope caption.
     */
    suspend fun uploadPhoto(
        chatId: Long,
        localFile: File,
        metadata: TelegramMetadataEnvelope
    ): TelegramMediaResult {
        require(localFile.exists()) { "Local source file does not exist: ${localFile.name}" }

        // Check if item was already uploaded before (uncertain outcome reconciliation)
        val existing = findExistingMedia(chatId, metadata.mediaId, metadata.contentHash)
        if (existing != null) {
            Log.d(tag, "Found existing upload during reconciliation for mediaId: ${metadata.mediaId}")
            return existing
        }

        val caption = TelegramMetadataEnvelope.serializeToCaption(metadata)
        val formattedText = TdApi.FormattedText().apply {
            this.text = caption
            this.entities = emptyArray()
        }
        val inputFile = TdApi.InputFileLocal().apply {
            this.path = localFile.absolutePath
        }
        val content = if (metadata.encryptionEnvelope != null) {
            val inputDoc = TdApi.InputDocument().apply {
                this.document = inputFile
            }
            TdApi.InputMessageDocument().apply {
                this.document = inputDoc
                this.caption = formattedText
            }
        } else {
            val inputPhoto = TdApi.InputPhoto().apply {
                this.photo = inputFile
            }
            TdApi.InputMessagePhoto().apply {
                this.photo = inputPhoto
                this.caption = formattedText
            }
        }

        val sendMessageReq = TdApi.SendMessage().apply {
            this.chatId = chatId
            this.inputMessageContent = content
        }
        val message: TdApi.Message = tdLibService.send(sendMessageReq)

        val remoteFile = extractFileFromMessage(message)
        val fileId = remoteFile?.id ?: 0

        // Wait for TDLib to finish reading and uploading the file before returning
        val finalMessageId = waitForUploadCompletion(message, fileId)

        return TelegramMediaResult(
            messageId = finalMessageId,
            chatId = message.chatId,
            fileId = fileId,
            remoteFileId = remoteFile?.remote?.id,
            metadata = metadata,
            date = message.date
        )
    }

    /**
     * Uploads a video to the specified channel with an attached metadata envelope caption.
     */
    suspend fun uploadVideo(
        chatId: Long,
        localFile: File,
        metadata: TelegramMetadataEnvelope,
        durationSeconds: Int = 0,
        width: Int = 0,
        height: Int = 0
    ): TelegramMediaResult {
        require(localFile.exists()) { "Local source file does not exist: ${localFile.name}" }

        val existing = findExistingMedia(chatId, metadata.mediaId, metadata.contentHash)
        if (existing != null) {
            Log.d(tag, "Found existing video upload during reconciliation for mediaId: ${metadata.mediaId}")
            return existing
        }

        val caption = TelegramMetadataEnvelope.serializeToCaption(metadata)
        val formattedText = TdApi.FormattedText().apply {
            this.text = caption
            this.entities = emptyArray()
        }
        val inputFile = TdApi.InputFileLocal().apply {
            this.path = localFile.absolutePath
        }
        val content = if (metadata.encryptionEnvelope != null) {
            val inputDoc = TdApi.InputDocument().apply {
                this.document = inputFile
            }
            TdApi.InputMessageDocument().apply {
                this.document = inputDoc
                this.caption = formattedText
            }
        } else {
            val inputVideo = TdApi.InputVideo().apply {
                this.video = inputFile
                this.duration = durationSeconds
                this.width = width
                this.height = height
                this.supportsStreaming = true
            }
            TdApi.InputMessageVideo().apply {
                this.video = inputVideo
                this.caption = formattedText
            }
        }

        val sendMessageReq = TdApi.SendMessage().apply {
            this.chatId = chatId
            this.inputMessageContent = content
        }
        val message: TdApi.Message = tdLibService.send(sendMessageReq)

        val remoteFile = extractFileFromMessage(message)
        val fileId = remoteFile?.id ?: 0

        // Wait for TDLib to finish reading and uploading the file before returning
        val finalMessageId = waitForUploadCompletion(message, fileId)

        return TelegramMediaResult(
            messageId = finalMessageId,
            chatId = message.chatId,
            fileId = fileId,
            remoteFileId = remoteFile?.remote?.id,
            metadata = metadata,
            date = message.date
        )
    }

    /**
     * Waits for TDLib to finish reading and uploading the file.
     * Prevents temporary file deletion while transfer is still active.
     */
    private suspend fun waitForUploadCompletion(message: TdApi.Message, fileId: Int, timeoutMs: Long = 180_000): Long {
        if (message.sendingState == null) {
            return message.id
        }

        val result = withTimeoutOrNull(timeoutMs) {
            tdLibService.updates.filter { update ->
                when (update) {
                    is TdApi.UpdateMessageSendSucceeded -> {
                        update.message.id == message.id || update.oldMessageId == message.id
                    }
                    is TdApi.UpdateMessageSendFailed -> {
                        if (update.message.id == message.id || update.oldMessageId == message.id) {
                            val errCode = update.error?.code ?: -1
                            val errMsg = update.error?.message ?: "Unknown TDLib error"
                            throw IllegalStateException("Telegram message upload failed: [$errCode] $errMsg")
                        }
                        false
                    }
                    is TdApi.UpdateFile -> {
                        update.file.id == fileId && update.file.remote.isUploadingCompleted
                    }
                    else -> false
                }
            }.first()
        }

        return if (result is TdApi.UpdateMessageSendSucceeded) {
            result.message.id
        } else {
            message.id
        }
    }

    /**
     * Deletes specified messages from the channel for all participants.
     */
    suspend fun deleteMessages(chatId: Long, messageIds: List<Long>): Boolean {
        if (messageIds.isEmpty()) return true
        val req = TdApi.DeleteMessages().apply {
            this.chatId = chatId
            this.messageIds = messageIds.toLongArray()
            this.revoke = true
        }
        tdLibService.send(req)
        return true
    }

    /**
     * Reconciles uncertain outcomes: searches recent messages in the channel for matching media ID and content hash.
     * Avoids duplicate messages after app kill or network disconnect.
     */
    suspend fun findExistingMedia(chatId: Long, mediaId: String, contentHash: String?): TelegramMediaResult? {
        val history = getChannelHistory(chatId, limit = 50)
        return history.firstOrNull { item ->
            item.metadata.mediaId == mediaId &&
                    (contentHash == null || item.metadata.contentHash == contentHash)
        }
    }

    /**
     * Paginates through channel history and parses all messages with Telegram Gallery Backup metadata.
     * Supports bounded multi-batch pagination up to requested limit.
     */
    suspend fun getChannelHistory(
        chatId: Long,
        fromMessageId: Long = 0,
        limit: Int = 100
    ): List<TelegramMediaResult> {
        val results = mutableListOf<TelegramMediaResult>()
        var currentFromMsgId = fromMessageId
        var remaining = limit

        while (remaining > 0) {
            val batchSize = Math.min(remaining, 100)
            val req = TdApi.GetChatHistory().apply {
                this.chatId = chatId
                this.fromMessageId = currentFromMsgId
                this.offset = 0
                this.limit = batchSize
                this.onlyLocal = false
            }
            val messages: TdApi.Messages = try {
                tdLibService.send(req)
            } catch (e: Exception) {
                break
            }

            if (messages.messages.isEmpty()) break

            for (message in messages.messages) {
                val caption = extractCaptionFromMessage(message)
                val metadata = TelegramMetadataEnvelope.parseFromCaption(caption) ?: continue
                val file = extractFileFromMessage(message)

                results.add(
                    TelegramMediaResult(
                        messageId = message.id,
                        chatId = message.chatId,
                        fileId = file?.id ?: 0,
                        remoteFileId = file?.remote?.id,
                        metadata = metadata,
                        date = message.date
                    )
                )
            }

            remaining -= messages.messages.size
            currentFromMsgId = messages.messages.last().id
            if (messages.messages.size < batchSize) break
        }

        return results
    }

    /**
     * Downloads a file by fileId and waits for completion.
     * Returns the local File once fully downloaded.
     */
    suspend fun downloadMediaFile(fileId: Int, timeoutMs: Long = 60_000): File? {
        try {
            val initialFile: TdApi.File = tdLibService.send(TdApi.GetFile(fileId))
            if (initialFile.local.isDownloadingCompleted && !initialFile.local.path.isNullOrEmpty()) {
                val f = File(initialFile.local.path)
                if (f.exists()) return f
            }
        } catch (_: Exception) {}

        // Request download
        val downloadReq = TdApi.DownloadFile().apply {
            this.fileId = fileId
            this.priority = 32
            this.offset = 0
            this.limit = 0
            this.synchronous = false
        }
        tdLibService.send(downloadReq)

        // Wait for UpdateFile event where isDownloadingCompleted is true
        val completedFile = withTimeoutOrNull(timeoutMs) {
            tdLibService.updates
                .filter { it is TdApi.UpdateFile && it.file.id == fileId && it.file.local.isDownloadingCompleted }
                .first() as TdApi.UpdateFile
        }

        val path = completedFile?.file?.local?.path
        return if (!path.isNullOrEmpty()) File(path) else null
    }

    private fun extractCaptionFromMessage(message: TdApi.Message): String? {
        return when (val content = message.content) {
            is TdApi.MessagePhoto -> content.caption.text
            is TdApi.MessageVideo -> content.caption.text
            is TdApi.MessageDocument -> content.caption.text
            else -> null
        }
    }

    private fun extractFileFromMessage(message: TdApi.Message): TdApi.File? {
        return when (val content = message.content) {
            is TdApi.MessagePhoto -> {
                // Return largest photo size
                content.photo.sizes.maxByOrNull { it.photo.size }?.photo
            }
            is TdApi.MessageVideo -> content.video.video
            is TdApi.MessageDocument -> content.document.document
            else -> null
        }
    }
}
