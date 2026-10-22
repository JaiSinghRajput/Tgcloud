package com.telegramgallerybackup.app.telegram

import android.util.Log
import org.drinkless.tdlib.TdApi

/**
 * Manages discovery, creation, and verification of the two private Telegram backup channels:
 * 1) Photos channel ("Backup - Photos")
 * 2) Videos channel ("Backup - Videos")
 */
class TelegramChannelManager(private val tdLibService: TdLibService) {

    private val tag = "TelegramChannelManager"

    /**
     * Finds existing private backup channels or creates them if missing.
     * Verifies that the current user has write access.
     */
    suspend fun getOrCreateBackupChannels(): TelegramBackupChannels {
        var photoChannel = findChannelByTitle(TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE)
        var videoChannel = findChannelByTitle(TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE)

        if (photoChannel == null) {
            Log.d(tag, "Photo backup channel not found. Creating private channel...")
            photoChannel = createPrivateChannel(
                title = TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE,
                description = TelegramBackupChannels.BACKUP_CHANNEL_DESCRIPTION
            )
        }

        if (videoChannel == null) {
            Log.d(tag, "Video backup channel not found. Creating private channel...")
            videoChannel = createPrivateChannel(
                title = TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE,
                description = TelegramBackupChannels.BACKUP_CHANNEL_DESCRIPTION
            )
        }

        val verified = verifyChannelAccess(photoChannel.id) && verifyChannelAccess(videoChannel.id)

        return TelegramBackupChannels(
            photoChannelId = photoChannel.id,
            photoChannelTitle = photoChannel.title,
            videoChannelId = videoChannel.id,
            videoChannelTitle = videoChannel.title,
            verified = verified
        )
    }

    /**
     * Searches server chats for a channel with matching title.
     */
    private suspend fun findChannelByTitle(targetTitle: String): TdApi.Chat? {
        return try {
            val searchResult = tdLibService.send(TdApi.SearchChatsOnServer(targetTitle, 20))
            for (chatId in searchResult.chatIds) {
                val chat = tdLibService.send(TdApi.GetChat(chatId))
                if (chat.title.equals(targetTitle, ignoreCase = true)) {
                    val chatType = chat.type
                    if (chatType is TdApi.ChatTypeSupergroup && chatType.isChannel) {
                        return chat
                    }
                }
            }
            null
        } catch (e: Exception) {
            Log.w(tag, "Error searching for channel '$targetTitle': ${e.message}")
            null
        }
    }

    /**
     * Creates a new private broadcast channel (isChannel = true, not public).
     */
    suspend fun createPrivateChannel(title: String, description: String): TdApi.Chat {
        return tdLibService.send(
            TdApi.CreateNewSupergroupChat(
                title,
                true, // isChannel = true
                description,
                null, // location
                false, // forImport
                false  // isForum
            )
        )
    }

    /**
     * Verifies that the app can post messages to the specified chat.
     */
    suspend fun verifyChannelAccess(chatId: Long): Boolean {
        return try {
            val chat = tdLibService.send(TdApi.GetChat(chatId))
            // Check canSendBasicContent or admin permissions
            val permissions = chat.permissions
            val canSend = permissions.canSendBasicContent
            val canPost = when (val type = chat.type) {
                is TdApi.ChatTypeSupergroup -> {
                    // In a supergroup channel, creator/admin can post
                    true
                }
                else -> canSend
            }
            canPost
        } catch (e: Exception) {
            Log.e(tag, "Failed to verify channel access for $chatId: ${e.message}")
            false
        }
    }
}
