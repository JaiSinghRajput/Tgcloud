package com.telegramgallerybackup.app.telegram

/**
 * Representation of the two private Telegram channels used for gallery backup.
 */
data class TelegramBackupChannels(
    val photoChannelId: Long,
    val photoChannelTitle: String,
    val videoChannelId: Long,
    val videoChannelTitle: String,
    val verified: Boolean
) {
    fun toMap(): Map<String, Any> {
        return mapOf(
            "photoChannelId" to photoChannelId.toString(),
            "photoChannelTitle" to photoChannelTitle,
            "videoChannelId" to videoChannelId.toString(),
            "videoChannelTitle" to videoChannelTitle,
            "verified" to verified
        )
    }

    companion object {
        const val PHOTO_CHANNEL_DEFAULT_TITLE = "Backup - Photos"
        const val VIDEO_CHANNEL_DEFAULT_TITLE = "Backup - Videos"
        const val BACKUP_CHANNEL_DESCRIPTION = "Automated private gallery backup channel managed by Telegram Gallery Backup. Do not share publicly."
    }
}
