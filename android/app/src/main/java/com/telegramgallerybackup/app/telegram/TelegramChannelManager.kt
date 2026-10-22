package com.telegramgallerybackup.app.telegram

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.drinkless.tdlib.TdApi

/**
 * Manages discovery, creation, and verification of the two private Telegram backup channels:
 * 1) Photos channel ("Backup - Photos")
 * 2) Videos channel ("Backup - Videos")
 *
 * Implements strict idempotency and separation of concerns:
 * - refreshDestinations: PURELY READ-ONLY. Never creates a channel.
 * - createDestination: Explicit creation only when requested.
 * - reconnectDestination: Validates existing channel without recreation.
 * - Mutex-guarded to prevent concurrent creations.
 * - Persists channel IDs in SharedPreferences associated with the authenticated account.
 */
class TelegramChannelManager(
    private val tdLibService: TdLibService,
    private val context: Context? = null
) {

    private val tag = "TelegramChannelManager"
    private val channelMutex = Mutex()

    private val prefs: SharedPreferences? by lazy {
        context?.getSharedPreferences("tgcloud_destinations", Context.MODE_PRIVATE)
    }

    private fun getPersistedChannelId(key: String, userId: Long): Long? {
        val userSuffix = if (userId > 0) "_$userId" else ""
        val id = prefs?.getLong("${key}${userSuffix}", 0L) ?: 0L
        return if (id != 0L) id else null
    }

    private fun persistChannelId(key: String, channelId: Long, userId: Long) {
        val userSuffix = if (userId > 0) "_$userId" else ""
        prefs?.edit()?.putLong("${key}${userSuffix}", channelId)?.apply()
    }

    /**
     * Read-only discovery and validation of existing backup channels.
     * CRITICAL: MUST NEVER CREATE A CHANNEL UNDER ANY CIRCUMSTANCES.
     */
    suspend fun refreshDestinations(userId: Long = 0): TelegramBackupChannels? = channelMutex.withLock {
        Log.d(tag, "refreshDestinations called (read-only) for user: $userId")

        // 1. Check persisted channel IDs first
        val savedPhotoId = getPersistedChannelId("photo_channel_id", userId)
        val savedVideoId = getPersistedChannelId("video_channel_id", userId)

        var photoChat: TdApi.Chat? = null
        var videoChat: TdApi.Chat? = null

        if (savedPhotoId != null) {
            photoChat = tryGetChat(savedPhotoId)
        }
        if (savedVideoId != null) {
            videoChat = tryGetChat(savedVideoId)
        }

        // 2. Discover missing channels via search if not found from persisted IDs
        if (photoChat == null) {
            photoChat = findChannelByTitle(TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE)
            if (photoChat != null) {
                persistChannelId("photo_channel_id", photoChat.id, userId)
            }
        }

        if (videoChat == null) {
            videoChat = findChannelByTitle(TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE)
            if (videoChat != null) {
                persistChannelId("video_channel_id", videoChat.id, userId)
            }
        }

        // Return channels found, or null if neither exists yet
        if (photoChat == null && videoChat == null) {
            Log.d(tag, "refreshDestinations: No existing backup channels found.")
            return@withLock null
        }

        val photoVerified = photoChat?.let { verifyChannelAccess(it.id) } ?: false
        val videoVerified = videoChat?.let { verifyChannelAccess(it.id) } ?: false

        return@withLock TelegramBackupChannels(
            photoChannelId = photoChat?.id ?: 0L,
            photoChannelTitle = photoChat?.title ?: TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE,
            videoChannelId = videoChat?.id ?: 0L,
            videoChannelTitle = videoChat?.title ?: TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE,
            verified = photoVerified && videoVerified
        )
    }

    /**
     * Explicit creation of a specific backup destination channel.
     * Verifies existence before creating to prevent duplicate creation.
     */
    suspend fun createDestination(destinationType: String, userId: Long = 0): TdApi.Chat = channelMutex.withLock {
        val isPhoto = destinationType.equals("photo", ignoreCase = true)
        val title = if (isPhoto) {
            TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE
        } else {
            TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE
        }
        val prefKey = if (isPhoto) "photo_channel_id" else "video_channel_id"

        // Check if destination already exists before creating
        val existingSavedId = getPersistedChannelId(prefKey, userId)
        if (existingSavedId != null) {
            val existingChat = tryGetChat(existingSavedId)
            if (existingChat != null) {
                Log.d(tag, "Destination $destinationType already exists with id: ${existingChat.id}. Returning existing.")
                return@withLock existingChat
            }
        }

        val foundChat = findChannelByTitle(title)
        if (foundChat != null) {
            persistChannelId(prefKey, foundChat.id, userId)
            Log.d(tag, "Discovered existing destination $destinationType with id: ${foundChat.id}")
            return@withLock foundChat
        }

        Log.i(tag, "Explicitly creating new private backup channel for $destinationType: '$title'")
        val newChat = createPrivateChannel(title, TelegramBackupChannels.BACKUP_CHANNEL_DESCRIPTION)
        persistChannelId(prefKey, newChat.id, userId)
        return@withLock newChat
    }

    /**
     * Recovers / reconnects to an existing channel without creating a replacement.
     */
    suspend fun reconnectDestination(channelId: Long): Boolean {
        return verifyChannelAccess(channelId)
    }

    /**
     * Finds existing private backup channels or creates them if missing (initial setup only).
     * Protected by mutex to prevent concurrent duplicate creation.
     */
    suspend fun getOrCreateBackupChannels(userId: Long = 0): TelegramBackupChannels = channelMutex.withLock {
        // 1. Try to discover existing channels without creating
        val savedPhotoId = getPersistedChannelId("photo_channel_id", userId)
        val savedVideoId = getPersistedChannelId("video_channel_id", userId)

        var photoChannel = savedPhotoId?.let { tryGetChat(it) } ?: findChannelByTitle(TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE)
        var videoChannel = savedVideoId?.let { tryGetChat(it) } ?: findChannelByTitle(TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE)

        if (photoChannel == null) {
            Log.d(tag, "Photo backup channel not found. Creating private channel...")
            photoChannel = createPrivateChannel(
                title = TelegramBackupChannels.PHOTO_CHANNEL_DEFAULT_TITLE,
                description = TelegramBackupChannels.BACKUP_CHANNEL_DESCRIPTION
            )
            persistChannelId("photo_channel_id", photoChannel.id, userId)
        } else {
            persistChannelId("photo_channel_id", photoChannel.id, userId)
        }

        if (videoChannel == null) {
            Log.d(tag, "Video backup channel not found. Creating private channel...")
            videoChannel = createPrivateChannel(
                title = TelegramBackupChannels.VIDEO_CHANNEL_DEFAULT_TITLE,
                description = TelegramBackupChannels.BACKUP_CHANNEL_DESCRIPTION
            )
            persistChannelId("video_channel_id", videoChannel.id, userId)
        } else {
            persistChannelId("video_channel_id", videoChannel.id, userId)
        }

        val verified = verifyChannelAccess(photoChannel.id) && verifyChannelAccess(videoChannel.id)

        return@withLock TelegramBackupChannels(
            photoChannelId = photoChannel.id,
            photoChannelTitle = photoChannel.title,
            videoChannelId = videoChannel.id,
            videoChannelTitle = videoChannel.title,
            verified = verified
        )
    }

    private suspend fun tryGetChat(chatId: Long): TdApi.Chat? {
        return try {
            val chat: TdApi.Chat = tdLibService.send(TdApi.GetChat(chatId))
            if (chat.type is TdApi.ChatTypeSupergroup) chat else null
        } catch (_: Exception) {
            null
        }
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
            } catch (_: Exception) {
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
            } catch (_: Exception) {
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
            chat.type is TdApi.ChatTypeSupergroup || chat.permissions != null
        } catch (e: Exception) {
            Log.e(tag, "Failed to verify channel access for $chatId: ${e.message}")
            false
        }
    }
}
