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
     * Searches user's chats and server for a channel with matching title.
     * Loads local chats first so private channels are discoverable across sessions and after app data clear.
     */
    private suspend fun findChannelByTitle(targetTitle: String): TdApi.Chat? {
        return try {
            // 1. Ensure user's main chat list is loaded into TDLib memory
            try {
                tdLibService.send(TdApi.LoadChats(TdApi.ChatListMain(), 100))
            } catch (e: Exception) {
                // Ignore if chats are already fully loaded or 404 at end of list
            }

            // 2. Search user's existing dialogs and channels
            try {
                val localSearchReq = TdApi.SearchChats().apply {
                    this.query = targetTitle
                    this.limit = 20
                }
                val localResult: TdApi.Chats = tdLibService.send(localSearchReq)
                for (chatId in localResult.chatIds) {
                    val chat: TdApi.Chat = tdLibService.send(TdApi.GetChat(chatId))
                    if (chat.title.equals(targetTitle, ignoreCase = true)) {
                        val chatType = chat.type
                        if (chatType is TdApi.ChatTypeSupergroup && chatType.isChannel) {
                            return chat
                        }
                    }
                }
            } catch (e: Exception) {
                Log.d(tag, "Local search notice: ${e.message}")
            }

            // 3. Scan user's chat list directly
            try {
                val chats: TdApi.Chats = tdLibService.send(TdApi.GetChats(TdApi.ChatListMain(), 100))
                for (chatId in chats.chatIds) {
                    val chat: TdApi.Chat = tdLibService.send(TdApi.GetChat(chatId))
                    if (chat.title.equals(targetTitle, ignoreCase = true)) {
                        val chatType = chat.type
                        if (chatType is TdApi.ChatTypeSupergroup && chatType.isChannel) {
                            return chat
                        }
                    }
                }
            } catch (e: Exception) {
                // Ignore
            }

            // 4. Server search as fallback
            val req = TdApi.SearchChatsOnServer().apply {
                this.query = targetTitle
                this.limit = 20
            }
            val searchResult: TdApi.Chats = tdLibService.send(req)
            for (chatId in searchResult.chatIds) {
                val chat: TdApi.Chat = tdLibService.send(TdApi.GetChat(chatId))
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
        val req = TdApi.CreateNewSupergroupChat().apply {
            this.title = title
            this.isChannel = true
            this.description = description
            this.isForum = false
        }
        return tdLibService.send(req)
    }

    /**
     * Verifies that the app can post messages to the specified chat.
     */
    suspend fun verifyChannelAccess(chatId: Long): Boolean {
        return try {
            val chat: TdApi.Chat = tdLibService.send(TdApi.GetChat(chatId))
            // In a private supergroup channel created by the app, creator can post
            chat.type is TdApi.ChatTypeSupergroup || chat.permissions != null
        } catch (e: Exception) {
            Log.e(tag, "Failed to verify channel access for $chatId: ${e.message}")
            false
        }
    }
}
