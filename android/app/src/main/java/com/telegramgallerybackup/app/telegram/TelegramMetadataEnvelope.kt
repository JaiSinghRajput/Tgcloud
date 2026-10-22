package com.telegramgallerybackup.app.telegram

import org.json.JSONException
import org.json.JSONObject

/**
 * Versioned metadata envelope attached to Telegram messages in channel backups.
 * Allows rebuilding the local index from channel history without prior local database.
 */
data class TelegramMetadataEnvelope(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val app: String = APP_IDENTIFIER,
    val mediaId: String,
    val mediaType: String, // "photo" or "video"
    val originalName: String,
    val relativePath: String,
    val mimeType: String,
    val sizeBytes: Long,
    val modifiedAtMs: Long,
    val contentHash: String? = null,
    val encryptionEnvelope: String? = null
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION = 1
        const val APP_IDENTIFIER = "telegram-gallery-backup"
        private const val PREFIX = "#TGB1:"

        /**
         * Serializes the envelope into a compact Telegram message caption string.
         */
        fun serializeToCaption(envelope: TelegramMetadataEnvelope): String {
            val json = JSONObject().apply {
                put("v", envelope.schemaVersion)
                put("app", envelope.app)
                put("id", envelope.mediaId)
                put("type", envelope.mediaType)
                put("name", envelope.originalName)
                put("path", envelope.relativePath)
                put("mime", envelope.mimeType)
                put("size", envelope.sizeBytes)
                put("mod", envelope.modifiedAtMs)
                if (envelope.contentHash != null) {
                    put("hash", envelope.contentHash)
                }
                if (envelope.encryptionEnvelope != null) {
                    put("enc", envelope.encryptionEnvelope)
                }
            }
            return "$PREFIX${json}"
        }

        /**
         * Parses the envelope from a Telegram message caption.
         * Returns null if caption does not contain the app's marker or is malformed.
         */
        fun parseFromCaption(caption: String?): TelegramMetadataEnvelope? {
            if (caption == null) return null
            val prefixIndex = caption.indexOf(PREFIX)
            if (prefixIndex == -1) return null

            val jsonString = caption.substring(prefixIndex + PREFIX.length).trim()
            return try {
                val json = JSONObject(jsonString)
                val version = json.optInt("v", -1)
                val app = json.optString("app", "")

                if (version != CURRENT_SCHEMA_VERSION || app != APP_IDENTIFIER) {
                    return null
                }

                val mediaId = json.getString("id")
                val mediaType = json.getString("type")
                val originalName = json.getString("name")
                val relativePath = json.optString("path", "")
                val mimeType = json.optString("mime", "application/octet-stream")
                val sizeBytes = json.getLong("size")
                val modifiedAtMs = json.getLong("mod")
                val contentHash = if (json.has("hash")) json.getString("hash") else null
                val encryptionEnvelope = if (json.has("enc")) json.get("enc").toString() else null

                TelegramMetadataEnvelope(
                    schemaVersion = version,
                    app = app,
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
            } catch (e: JSONException) {
                null
            }
        }
    }
}
