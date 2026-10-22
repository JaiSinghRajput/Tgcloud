package com.telegramgallerybackup.app.telegram

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class TdLibException(val code: Int, override val message: String) : Exception("TDLib error [$code]: $message")

/**
 * Service managing TDLib native client lifecycle, updates stream, and authentication state machine.
 */
class TdLibService(private val context: Context) {

    private val tag = "TdLibService"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var client: Client? = null
    private var apiId: Int = 0
    private var apiHash: String = ""

    private val _updates = MutableSharedFlow<TdApi.Update>(extraBufferCapacity = 64)
    val updates: SharedFlow<TdApi.Update> = _updates.asSharedFlow()

    private val _authState = MutableStateFlow<TelegramAuthState>(TelegramAuthState.Uninitialized)
    val authState: StateFlow<TelegramAuthState> = _authState.asStateFlow()

    companion object {
        private var isNativeLoaded = false

        fun loadNativeLibrary() {
            if (!isNativeLoaded) {
                try {
                    System.loadLibrary("tdjson")
                    isNativeLoaded = true
                } catch (e: UnsatisfiedLinkError) {
                    Log.e("TdLibService", "Failed to load libtdjson.so: ${e.message}")
                }
            }
        }
    }

    init {
        loadNativeLibrary()
    }

    /**
     * Initializes TDLib with the user's API credentials.
     * State is stored in app-private files directory: context.filesDir/tdlib
     */
    @Synchronized
    fun initialize(apiId: Int, apiHash: String) {
        if (client != null) {
            Log.d(tag, "TDLib client already initialized")
            return
        }

        this.apiId = apiId
        this.apiHash = apiHash

        // Ensure app-private storage directory exists
        val tdlibDir = File(context.filesDir, "tdlib").apply { mkdirs() }
        val filesDir = File(context.filesDir, "tdlib_files").apply { mkdirs() }

        client = Client.create(
            { update ->
                if (update is TdApi.Update) {
                    handleUpdate(update)
                    scope.launch { _updates.emit(update) }
                }
            },
            { error ->
                Log.e(tag, "TDLib update error: ${error.message}")
            },
            { defaultHandler ->
                Log.e(tag, "TDLib default handler error: ${defaultHandler.message}")
            }
        )

        // Disable verbose TDLib native logs to avoid leaking personal data
        client?.send(TdApi.SetLogVerbosityLevel(1)) { }
    }

    /**
     * Handles TDLib updates internally to track auth states and parameters requests.
     */
    private fun handleUpdate(update: TdApi.Update) {
        when (update) {
            is TdApi.UpdateAuthorizationState -> {
                when (val state = update.authorizationState) {
                    is TdApi.AuthorizationStateWaitTdlibParameters -> {
                        _authState.value = TelegramAuthState.WaitParameters
                        sendTdlibParameters()
                    }
                    is TdApi.AuthorizationStateWaitPhoneNumber -> {
                        _authState.value = TelegramAuthState.WaitPhoneNumber
                    }
                    is TdApi.AuthorizationStateWaitCode -> {
                        _authState.value = TelegramAuthState.WaitCode(
                            isRegistered = true,
                            timeout = state.codeInfo.timeout
                        )
                    }
                    is TdApi.AuthorizationStateWaitPassword -> {
                        _authState.value = TelegramAuthState.WaitPassword(hint = state.passwordHint)
                    }
                    is TdApi.AuthorizationStateReady -> {
                        scope.launch {
                            try {
                                val me = send(TdApi.GetMe())
                                _authState.value = TelegramAuthState.Ready(
                                    userId = me.id,
                                    firstName = me.firstName,
                                    lastName = me.lastName
                                )
                            } catch (e: Exception) {
                                _authState.value = TelegramAuthState.Ready(0, "User", "")
                            }
                        }
                    }
                    is TdApi.AuthorizationStateLoggingOut -> {
                        _authState.value = TelegramAuthState.LoggingOut
                    }
                    is TdApi.AuthorizationStateClosed -> {
                        _authState.value = TelegramAuthState.Closed
                        client = null
                    }
                }
            }
        }
    }

    /**
     * Sends TDLib initialization parameters to TDLib client.
     */
    private fun sendTdlibParameters() {
        val tdlibDir = File(context.filesDir, "tdlib").absolutePath
        val filesDir = File(context.filesDir, "tdlib_files").absolutePath

        val parameters = TdApi.SetTdlibParameters().apply {
            useTestDc = false
            databaseDirectory = tdlibDir
            filesDirectory = filesDir
            useFileDatabase = true
            useChatInfoDatabase = true
            useMessageDatabase = true
            useSecretChats = false
            apiId = this@TdLibService.apiId
            apiHash = this@TdLibService.apiHash
            systemLanguageCode = "en"
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}"
            systemVersion = Build.VERSION.RELEASE
            applicationVersion = "1.0.0"
        }

        client?.send(parameters) { result ->
            if (result is TdApi.Error) {
                Log.e(tag, "Failed to set TDLib parameters: [${result.code}] ${result.message}")
                _authState.value = TelegramAuthState.Error(result.code, result.message)
            }
        }
    }

    /**
     * Submits phone number for authentication.
     */
    suspend fun setPhoneNumber(phoneNumber: String) {
        val settings = TdApi.PhoneNumberAuthenticationSettings()
        send(TdApi.SetAuthenticationPhoneNumber(phoneNumber, settings))
    }

    /**
     * Submits authentication code received via SMS/Telegram.
     */
    suspend fun checkAuthCode(code: String) {
        send(TdApi.CheckAuthenticationCode(code))
    }

    /**
     * Submits 2FA cloud password if user has two-step verification enabled.
     */
    suspend fun checkPassword(password: String) {
        send(TdApi.CheckAuthenticationPassword(password))
    }

    /**
     * Logs out the current session and cleans up.
     */
    suspend fun logOut() {
        send(TdApi.LogOut())
    }

    /**
     * Core suspending bridge to execute any TDLib function with coroutines.
     */
    suspend fun <T : TdApi.Object> send(function: TdApi.Function<T>): T = suspendCancellableCoroutine { continuation ->
        val activeClient = client
        if (activeClient == null) {
            continuation.resumeWithException(IllegalStateException("TDLib client is not initialized"))
            return@suspendCancellableCoroutine
        }

        activeClient.send(function) { result ->
            if (result is TdApi.Error) {
                continuation.resumeWithException(TdLibException(result.code, result.message))
            } else {
                @Suppress("UNCHECKED_CAST")
                continuation.resume(result as T)
            }
        }
    }

    /**
     * Safely closes the TDLib client.
     */
    fun close() {
        client?.send(TdApi.Close()) { }
    }
}
