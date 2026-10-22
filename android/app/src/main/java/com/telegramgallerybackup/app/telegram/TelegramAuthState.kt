package com.telegramgallerybackup.app.telegram

/**
 * Type-safe representation of Telegram authorization states for the app.
 */
sealed class TelegramAuthState {
    object Uninitialized : TelegramAuthState()
    object WaitParameters : TelegramAuthState()
    object WaitPhoneNumber : TelegramAuthState()
    data class WaitCode(val isRegistered: Boolean, val timeout: Int = 0) : TelegramAuthState()
    data class WaitPassword(val hint: String? = null) : TelegramAuthState()
    data class Ready(val userId: Long, val firstName: String, val lastName: String) : TelegramAuthState()
    object LoggingOut : TelegramAuthState()
    object Closed : TelegramAuthState()
    data class Error(val code: Int, val message: String) : TelegramAuthState()

    fun toMap(): Map<String, Any?> {
        return when (this) {
            is Uninitialized -> mapOf("state" to "UNINITIALIZED")
            is WaitParameters -> mapOf("state" to "WAIT_PARAMETERS")
            is WaitPhoneNumber -> mapOf("state" to "WAIT_PHONE_NUMBER")
            is WaitCode -> mapOf("state" to "WAIT_CODE", "isRegistered" to isRegistered, "timeout" to timeout)
            is WaitPassword -> mapOf("state" to "WAIT_PASSWORD", "hint" to hint)
            is Ready -> mapOf("state" to "READY", "userId" to userId, "firstName" to firstName, "lastName" to lastName)
            is LoggingOut -> mapOf("state" to "LOGGING_OUT")
            is Closed -> mapOf("state" to "CLOSED")
            is Error -> mapOf("state" to "ERROR", "code" to code, "message" to message)
        }
    }
}
