package com.telegramgallerybackup.app.telegram

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TelegramMetadataEnvelopeTest {

    @Test
    fun serializeAndParse_validEnvelope_roundtripsCorrectly() {
        val original = TelegramMetadataEnvelope(
            schemaVersion = 1,
            app = TelegramMetadataEnvelope.APP_IDENTIFIER,
            mediaId = "test-media-12345",
            mediaType = "photo",
            originalName = "IMG_20261022.jpg",
            relativePath = "DCIM/Camera/IMG_20261022.jpg",
            mimeType = "image/jpeg",
            sizeBytes = 2845678L,
            modifiedAtMs = 1792660000000L,
            contentHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            encryptionEnvelope = null
        )

        val caption = TelegramMetadataEnvelope.serializeToCaption(original)
        assertNotNull(caption)
        assert(caption.startsWith("#TGB1:"))

        val parsed = TelegramMetadataEnvelope.parseFromCaption(caption)
        assertNotNull(parsed)
        assertEquals(original.schemaVersion, parsed?.schemaVersion)
        assertEquals(original.app, parsed?.app)
        assertEquals(original.mediaId, parsed?.mediaId)
        assertEquals(original.mediaType, parsed?.mediaType)
        assertEquals(original.originalName, parsed?.originalName)
        assertEquals(original.relativePath, parsed?.relativePath)
        assertEquals(original.mimeType, parsed?.mimeType)
        assertEquals(original.sizeBytes, parsed?.sizeBytes)
        assertEquals(original.modifiedAtMs, parsed?.modifiedAtMs)
        assertEquals(original.contentHash, parsed?.contentHash)
        assertEquals(original.encryptionEnvelope, parsed?.encryptionEnvelope)
    }

    @Test
    fun parseFromCaption_withEncryptedSidecar_preservesEncField() {
        val original = TelegramMetadataEnvelope(
            schemaVersion = 1,
            app = TelegramMetadataEnvelope.APP_IDENTIFIER,
            mediaId = "enc-media-777",
            mediaType = "video",
            originalName = "VID_2026.mp4",
            relativePath = "DCIM/Camera/VID_2026.mp4",
            mimeType = "video/mp4",
            sizeBytes = 10485760L,
            modifiedAtMs = 1792665000000L,
            contentHash = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
            encryptionEnvelope = "aes-gcm:iv=1234:tag=5678"
        )

        val caption = TelegramMetadataEnvelope.serializeToCaption(original)
        val parsed = TelegramMetadataEnvelope.parseFromCaption(caption)

        assertNotNull(parsed)
        assertEquals("aes-gcm:iv=1234:tag=5678", parsed?.encryptionEnvelope)
    }

    @Test
    fun parseFromCaption_unrelatedOrCorruptCaption_returnsNullGracefully() {
        assertNull(TelegramMetadataEnvelope.parseFromCaption(null))
        assertNull(TelegramMetadataEnvelope.parseFromCaption(""))
        assertNull(TelegramMetadataEnvelope.parseFromCaption("Just a normal photo caption without marker"))
        assertNull(TelegramMetadataEnvelope.parseFromCaption("#TGB1:NotJson"))
        assertNull(TelegramMetadataEnvelope.parseFromCaption("#TGB1:{\"v\":99,\"app\":\"other-app\"}"))
    }
}
