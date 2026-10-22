package com.telegramgallerybackup.app.bridge

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.telegramgallerybackup.app.telegram.TdLibService
import com.telegramgallerybackup.app.telegram.TelegramAuthState
import com.telegramgallerybackup.app.telegram.TelegramChannelManager
import com.telegramgallerybackup.app.telegram.TelegramMediaManager
import com.telegramgallerybackup.app.telegram.TelegramPocRunner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Native React Native bridge module exposing TDLib authentication,
 * channel setup, upload/download, and Phase 1 proof-of-concept runner to TypeScript.
 */
class TelegramBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val tdLibService = TdLibService(reactContext)
    private val channelManager = TelegramChannelManager(tdLibService)
    private val mediaManager = TelegramMediaManager(tdLibService)
    private val pocRunner = TelegramPocRunner(reactContext, tdLibService, channelManager, mediaManager)

    init {
        // Collect auth state changes and emit to React Native JS
        scope.launch {
            tdLibService.authState.collect { state ->
                val params = Arguments.createMap()
                state.toMap().forEach { (k, v) ->
                    when (v) {
                        is String -> params.putString(k, v)
                        is Number -> params.putDouble(k, v.toDouble())
                        is Boolean -> params.putBoolean(k, v)
                        null -> params.putNull(k)
                    }
                }
                sendEvent("onAuthStateChanged", params)
            }
        }
    }

    override fun getName(): String = "TelegramBridge"

    private fun sendEvent(eventName: String, params: Any?) {
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun initialize(apiId: Double, apiHash: String, promise: Promise) {
        try {
            tdLibService.initialize(apiId.toInt(), apiHash)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getAuthState(promise: Promise) {
        val state = tdLibService.authState.value
        val map = Arguments.createMap()
        state.toMap().forEach { (k, v) ->
            when (v) {
                is String -> map.putString(k, v)
                is Number -> map.putDouble(k, v.toDouble())
                is Boolean -> map.putBoolean(k, v)
                null -> map.putNull(k)
            }
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun sendPhoneNumber(phoneNumber: String, promise: Promise) {
        scope.launch {
            try {
                tdLibService.setPhoneNumber(phoneNumber)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("AUTH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun sendAuthCode(code: String, promise: Promise) {
        scope.launch {
            try {
                tdLibService.checkAuthCode(code)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("AUTH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun sendPassword(password: String, promise: Promise) {
        scope.launch {
            try {
                tdLibService.checkPassword(password)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("AUTH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun logOut(promise: Promise) {
        scope.launch {
            try {
                tdLibService.logOut()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("LOGOUT_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setupChannels(promise: Promise) {
        scope.launch {
            try {
                val channels = channelManager.getOrCreateBackupChannels()
                val map = Arguments.createMap().apply {
                    putString("photoChannelId", channels.photoChannelId.toString())
                    putString("photoChannelTitle", channels.photoChannelTitle)
                    putString("videoChannelId", channels.videoChannelId.toString())
                    putString("videoChannelTitle", channels.videoChannelTitle)
                    putBoolean("verified", channels.verified)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("CHANNEL_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun runPocTest(promise: Promise) {
        scope.launch {
            try {
                val result = pocRunner.runPoc()
                val map = Arguments.createMap().apply {
                    putBoolean("success", result.success)
                    putInt("totalSteps", result.totalSteps)
                    putInt("passedSteps", result.passedSteps)

                    val stepsArray = Arguments.createArray()
                    result.steps.forEach { step ->
                        val stepMap = Arguments.createMap().apply {
                            putInt("step", step.step)
                            putString("name", step.name)
                            putBoolean("passed", step.passed)
                            putString("message", step.message)
                            putDouble("durationMs", step.durationMs.toDouble())
                        }
                        stepsArray.pushMap(stepMap)
                    }
                    putArray("steps", stepsArray)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("POC_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getChannelHistory(chatId: String, limit: Double, fromMessageId: String, promise: Promise) {
        scope.launch {
            try {
                val cId = chatId.toLong()
                val fId = fromMessageId.toLongOrNull() ?: 0L
                val items = mediaManager.getChannelHistory(cId, fId, limit.toInt())
                val array = Arguments.createArray()
                items.forEach { item ->
                    val itemMap = Arguments.createMap().apply {
                        putString("messageId", item.messageId.toString())
                        putString("chatId", item.chatId.toString())
                        putInt("fileId", item.fileId)
                        putString("mediaId", item.metadata.mediaId)
                        putString("mediaType", item.metadata.mediaType)
                        putString("originalName", item.metadata.originalName)
                        putString("relativePath", item.metadata.relativePath)
                        putDouble("sizeBytes", item.metadata.sizeBytes.toDouble())
                        putDouble("modifiedAtMs", item.metadata.modifiedAtMs.toDouble())
                        putString("contentHash", item.metadata.contentHash)
                        putInt("date", item.date)
                    }
                    array.pushMap(itemMap)
                }
                promise.resolve(array)
            } catch (e: Exception) {
                promise.reject("HISTORY_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required for RN NativeEventEmitter
    }
}
