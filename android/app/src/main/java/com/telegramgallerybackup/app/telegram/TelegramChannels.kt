package com.telegramgallerybackup.app.telegram

/**
 * Lifecycle states for Telegram backup destinations.
 */
enum class DestinationLifecycleState {
    CONNECTED,
    CHECKING,
    UNREACHABLE,
    ACCESS_REVOKED,
    DELETED,
    NEEDS_SETUP,
    RECREATED
}

/**
 * Detailed status for a single destination channel.
 */
data class DestinationStatus(
    val channelId: Long,
    val title: String,
    val state: DestinationLifecycleState,
    val errorMessage: String? = null
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "channelId" to channelId.toString(),
            "title" to title,
            "state" to state.name,
            "errorMessage" to errorMessage
        )
    }
}

/**
 * Representation of the two private Telegram channels used for gallery backup.
 */
data class TelegramBackupChannels(
    val photoChannelId: Long,
    val photoChannelTitle: String,
    val videoChannelId: Long,
    val videoChannelTitle: String,
    val verified: Boolean,
    val photoStatus: DestinationStatus? = null,
    val videoStatus: DestinationStatus? = null
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "photoChannelId" to photoChannelId.toString(),
            "photoChannelTitle" to photoChannelTitle,
            "videoChannelId" to videoChannelId.toString(),
            "videoChannelTitle" to videoChannelTitle,
            "verified" to verified,
            "photoStatus" to photoStatus?.toMap(),
            "videoStatus" to videoStatus?.toMap()
        )
    }

    companion object {
        const val PHOTO_CHANNEL_DEFAULT_TITLE = "Backup - Photos"
        const val VIDEO_CHANNEL_DEFAULT_TITLE = "Backup - Videos"
        const val BACKUP_CHANNEL_DESCRIPTION = "Automated private gallery backup channel managed by Telegram Gallery Backup. Do not share publicly."
    }
}
