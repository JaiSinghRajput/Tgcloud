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
        val content = TdApi.InputMessagePhoto().apply {
            this.photo = inputFile
            this.caption = formattedText
        }

        val sendMessageReq = TdApi.SendMessage().apply {
            this.chatId = chatId
            this.inputMessageContent = content
        }
        val message: TdApi.Message = tdLibService.send(sendMessageReq)

        // Wait for file upload to complete
        val remoteFile = extractFileFromMessage(message)
        val fileId = remoteFile?.id ?: 0

        return TelegramMediaResult(
            messageId = message.id,
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
        val content = TdApi.InputMessageVideo().apply {
            this.video = inputFile
            this.duration = durationSeconds
            this.width = width
            this.height = height
            this.supportsStreaming = true
            this.caption = formattedText
        }

        val sendMessageReq = TdApi.SendMessage().apply {
            this.chatId = chatId
            this.inputMessageContent = content
        }
        val message: TdApi.Message = tdLibService.send(sendMessageReq)

        val remoteFile = extractFileFromMessage(message)
        val fileId = remoteFile?.id ?: 0

        return TelegramMediaResult(
            messageId = message.id,
            chatId = message.chatId,
            fileId = fileId,
            remoteFileId = remoteFile?.remote?.id,
            metadata = metadata,
            date = message.date
        )
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
     */
    suspend fun getChannelHistory(
        chatId: Long,
        fromMessageId: Long = 0,
        limit: Int = 50
    ): List<TelegramMediaResult> {
        val req = TdApi.GetChatHistory().apply {
            this.chatId = chatId
            this.fromMessageId = fromMessageId
            this.offset = 0
            this.limit = limit
            this.onlyLocal = false
        }
        val messages: TdApi.Messages = tdLibService.send(req)

        val results = mutableListOf<TelegramMediaResult>()
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
        return results
    }

    /**
     * Downloads a file by fileId and waits for completion.
     * Returns the local File once fully downloaded.
     */
    suspend fun downloadMediaFile(fileId: Int, timeoutMs: Long = 60_000): File? {
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
