package com.telegramgallerybackup.app.crypto

import java.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

data class EncryptedPayload(
    val ciphertext: ByteArray,
    val ivBase64: String,
    val tagBase64: String
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as EncryptedPayload
        return ciphertext.contentEquals(other.ciphertext) &&
                ivBase64 == other.ivBase64 &&
                tagBase64 == other.tagBase64
    }

    override fun hashCode(): Int {
        var result = ciphertext.contentHashCode()
        result = 31 * result + ivBase64.hashCode()
        result = 31 * result + tagBase64.hashCode()
        return result
    }
}

/**
 * Native Android Cryptographic Service implementing AES-256-GCM and PBKDF2-HMAC-SHA256.
 * Adheres to Gate E (Encryption Design) and provides hardware-accelerated security.
 */
object TelegramCryptoService {

    const val PBKDF2_ITERATIONS = 100000
    const val KEY_LENGTH_BITS = 256
    const val IV_LENGTH_BYTES = 12
    const val GCM_TAG_LENGTH_BITS = 128
    const val VERIFY_PAYLOAD_CONSTANT = "TGB_RECOVERY_KEY_VERIFIED_V1"

    private val secureRandom = SecureRandom()

    /**
     * Normalizes user-entered recovery key.
     */
    fun normalizeRecoveryKey(key: String): String {
        return key.trim().lowercase().replace(Regex("\\s+"), " ")
    }

    /**
     * Derives a 256-bit Master Key from a recovery passphrase using PBKDF2-HMAC-SHA256.
     */
    fun deriveMasterKey(
        recoveryKey: String,
        saltHex: String,
        iterations: Int = PBKDF2_ITERATIONS
    ): ByteArray {
        val normalized = normalizeRecoveryKey(recoveryKey)
        val salt = hexToBytes(saltHex)
        val spec = PBEKeySpec(normalized.toCharArray(), salt, iterations, KEY_LENGTH_BITS)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }

    /**
     * Encrypts plaintext bytes with AES-256-GCM.
     */
    fun encryptAesGcm(plaintext: ByteArray, key: ByteArray): EncryptedPayload {
        val iv = ByteArray(IV_LENGTH_BYTES)
        secureRandom.nextBytes(iv)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)

        val output = cipher.doFinal(plaintext)
        val tagLengthBytes = GCM_TAG_LENGTH_BITS / 8
        val ciphertextLength = output.size - tagLengthBytes

        val ciphertext = output.copyOfRange(0, ciphertextLength)
        val tag = output.copyOfRange(ciphertextLength, output.size)

        return EncryptedPayload(
            ciphertext = ciphertext,
            ivBase64 = Base64.getEncoder().encodeToString(iv),
            tagBase64 = Base64.getEncoder().encodeToString(tag)
        )
    }

    /**
     * Decrypts ciphertext bytes with AES-256-GCM.
     * Throws an exception if authentication tag verification fails (tamper detection).
     */
    fun decryptAesGcm(
        ciphertext: ByteArray,
        key: ByteArray,
        ivBase64: String,
        tagBase64: String
    ): ByteArray {
        val iv = Base64.getDecoder().decode(ivBase64)
        val tag = Base64.getDecoder().decode(tagBase64)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)

        // Concatenate ciphertext and tag for JCE GCM decryption
        val combined = ByteArray(ciphertext.size + tag.size)
        System.arraycopy(ciphertext, 0, combined, 0, ciphertext.size)
        System.arraycopy(tag, 0, combined, ciphertext.size, tag.size)

        return cipher.doFinal(combined)
    }

    /**
     * Encrypts a media file using AES-256-GCM under the given DEK.
     * Writes the ciphertext directly to outputFile and returns the IV and authentication tag.
     */
    fun encryptMediaFile(
        inputFile: File,
        outputFile: File,
        dek: ByteArray
    ): EncryptedPayload {
        val plaintext = inputFile.readBytes()
        val enc = encryptAesGcm(plaintext, dek)
        outputFile.writeBytes(enc.ciphertext)
        return enc
    }

    /**
     * Decrypts a media file using AES-256-GCM under the given DEK.
     * Writes the decrypted plaintext directly to outputFile.
     */
    fun decryptMediaFile(
        inputFile: File,
        outputFile: File,
        dek: ByteArray,
        ivBase64: String,
        tagBase64: String
    ) {
        val ciphertext = inputFile.readBytes()
        val decrypted = decryptAesGcm(ciphertext, dek, ivBase64, tagBase64)
        outputFile.writeBytes(decrypted)
    }

    /**
     * Detects if raw byte content contains known unencrypted media file signatures (magic bytes).
     * Used to prevent false locked state or decryption failures if files were stored as plaintext.
     */
    fun isPlaintextMedia(bytes: ByteArray): Boolean {
        if (bytes.size < 4) return false
        // JPEG: FF D8 FF
        if (bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte()) return true
        // PNG: 89 50 4E 47
        if (bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() && bytes[2] == 0x4E.toByte() && bytes[3] == 0x47.toByte()) return true
        // GIF: 47 49 46 38
        if (bytes[0] == 0x47.toByte() && bytes[1] == 0x49.toByte() && bytes[2] == 0x46.toByte() && bytes[3] == 0x38.toByte()) return true
        // MP4 / MOV / QuickTime: check for ftyp at offset 4
        if (bytes.size >= 12 &&
            bytes[4] == 'f'.code.toByte() && bytes[5] == 't'.code.toByte() &&
            bytes[6] == 'y'.code.toByte() && bytes[7] == 'p'.code.toByte()) return true
        // WebP: RIFF ... WEBP
        if (bytes.size >= 12 &&
            bytes[0] == 'R'.code.toByte() && bytes[1] == 'I'.code.toByte() &&
            bytes[2] == 'F'.code.toByte() && bytes[3] == 'F'.code.toByte() &&
            bytes[8] == 'W'.code.toByte() && bytes[9] == 'E'.code.toByte() &&
            bytes[10] == 'B'.code.toByte() && bytes[11] == 'P'.code.toByte()) return true
        return false
    }

    /**
     * Creates a verification token encrypted under the master key.
     */
    fun createVerificationToken(masterKey: ByteArray): String {
        val payload = VERIFY_PAYLOAD_CONSTANT.toByteArray(Charsets.UTF_8)
        val enc = encryptAesGcm(payload, masterKey)
        val json = JSONObject().apply {
            put("iv", enc.ivBase64)
            put("tag", enc.tagBase64)
            put("ct", Base64.getEncoder().encodeToString(enc.ciphertext))
        }
        return json.toString()
    }

    /**
     * Verifies if a recovery key satisfies the verification token.
     */
    fun verifyRecoveryKey(
        recoveryKey: String,
        saltHex: String,
        verificationTokenJson: String
    ): Boolean {
        return try {
            val masterKey = deriveMasterKey(recoveryKey, saltHex)
            val json = JSONObject(verificationTokenJson)
            val iv = json.getString("iv")
            val tag = json.getString("tag")
            val ct = Base64.getDecoder().decode(json.getString("ct"))

            val decrypted = decryptAesGcm(ct, masterKey, iv, tag)
            String(decrypted, Charsets.UTF_8) == VERIFY_PAYLOAD_CONSTANT
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Securely wipes a temporary file by overwriting its contents with zeros before deleting it.
     */
    fun secureWipe(file: File): Boolean {
        if (!file.exists()) return true
        return try {
            val length = file.length()
            if (length > 0) {
                RandomAccessFile(file, "rws").use { raf ->
                    val zeroBlock = ByteArray(minOf(length.toInt(), 4096))
                    var remaining = length
                    while (remaining > 0) {
                        val toWrite = minOf(remaining.toInt(), zeroBlock.size)
                        raf.write(zeroBlock, 0, toWrite)
                        remaining -= toWrite
                    }
                }
            }
            file.delete()
        } catch (e: Exception) {
            file.delete()
        }
    }

    private fun hexToBytes(hex: String): ByteArray {
        val len = hex.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = (
                (Character.digit(hex[i], 16) shl 4) +
                Character.digit(hex[i + 1], 16)
            ).toByte()
            i += 2
        }
        return data
    }
}
