package com.telegramgallerybackup.app.media

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.VideoView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.io.File

/**
 * Container view hosting a native Android VideoView for in-app video playback.
 * Handles MediaPlayer lifecycle, progress reporting, seeking, audio focus, layout measurement, and cleanup.
 */
class InAppVideoContainerView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

    private val tag = "InAppVideoView"
    private val videoView = VideoView(reactContext)
    private val handler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null
    private var audioManager: AudioManager? = null
    private var isPrepared = false
    private var shouldPlayWhenReady = true
    private var lastUri: String? = null

    init {
        val params = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
            gravity = Gravity.CENTER
        }
        videoView.layoutParams = params
        videoView.setZOrderMediaOverlay(true)
        addView(videoView)

        audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

        videoView.setOnPreparedListener { mp ->
            isPrepared = true
            mp.isLooping = false
            val duration = mp.duration
            Log.d(tag, "MediaPlayer prepared: duration=${duration}ms, size=${mp.videoWidth}x${mp.videoHeight}")
            sendEvent("ready", duration, 0, null)
            if (shouldPlayWhenReady) {
                requestAudioFocus()
                videoView.start()
                startProgressTracker()
                sendEvent("playing", duration, videoView.currentPosition, null)
            }
        }

        videoView.setOnCompletionListener {
            Log.d(tag, "MediaPlayer playback completed")
            stopProgressTracker()
            sendEvent("ended", videoView.duration, videoView.duration, null)
        }

        videoView.setOnErrorListener { _, what, extra ->
            Log.e(tag, "MediaPlayer error: what=$what, extra=$extra")
            stopProgressTracker()
            isPrepared = false
            val errorMsg = when (what) {
                MediaPlayer.MEDIA_ERROR_UNKNOWN -> "Video playback error (Unknown error $extra)"
                MediaPlayer.MEDIA_ERROR_SERVER_DIED -> "Media server died ($extra)"
                else -> "Video playback error (code: $what, extra: $extra)"
            }
            sendEvent("error", 0, 0, errorMsg)
            true
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val w = right - left
        val h = bottom - top
        videoView.measure(
            MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)
        )
        videoView.layout(0, 0, w, h)
    }

    override fun requestLayout() {
        super.requestLayout()
        post(measureAndLayoutRunnable)
    }

    private val measureAndLayoutRunnable = Runnable {
        measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    fun setSource(uriString: String?) {
        if (uriString.isNullOrEmpty()) {
            Log.d(tag, "setSource: empty uri, releasing player")
            releasePlayer()
            return
        }
        if (uriString == lastUri && isPrepared) {
            return
        }
        lastUri = uriString
        isPrepared = false
        sendEvent("loading", 0, 0, null)

        try {
            val uri = if (uriString.startsWith("/") && !uriString.startsWith("content://") && !uriString.startsWith("file://")) {
                Uri.fromFile(File(uriString))
            } else {
                Uri.parse(uriString)
            }

            Log.d(tag, "setSource: uri=$uri, scheme=${uri.scheme}")
            if (uri.scheme == "file") {
                val f = File(uri.path ?: "")
                Log.d(tag, "setSource: file path=${f.absolutePath}, exists=${f.exists()}, sizeBytes=${if (f.exists()) f.length() else -1}")
                if (!f.exists() || f.length() == 0L) {
                    sendEvent("error", 0, 0, "Video media file not found or empty (${f.name})")
                    return
                }
            }

            videoView.setVideoURI(uri)
        } catch (e: Exception) {
            Log.e(tag, "setSource failed: ${e.message}", e)
            sendEvent("error", 0, 0, "Failed to load video source: ${e.message}")
        }
    }

    fun setPlayWhenReady(play: Boolean) {
        shouldPlayWhenReady = play
        if (!isPrepared) return

        if (play) {
            requestAudioFocus()
            videoView.start()
            startProgressTracker()
            sendEvent("playing", videoView.duration, videoView.currentPosition, null)
        } else {
            videoView.pause()
            stopProgressTracker()
            sendEvent("paused", videoView.duration, videoView.currentPosition, null)
        }
    }

    fun seekTo(positionMs: Int) {
        if (isPrepared) {
            videoView.seekTo(positionMs)
            sendEvent("progress", videoView.duration, positionMs, null)
        }
    }

    private fun startProgressTracker() {
        stopProgressTracker()
        progressRunnable = object : Runnable {
            override fun run() {
                if (videoView.isPlaying) {
                    val current = videoView.currentPosition
                    val duration = videoView.duration
                    sendEvent("progress", duration, current, null)
                    handler.postDelayed(this, 300)
                }
            }
        }
        handler.post(progressRunnable!!)
    }

    private fun stopProgressTracker() {
        progressRunnable?.let { handler.removeCallbacks(it) }
        progressRunnable = null
    }

    private fun requestAudioFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val playbackAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                    .build()
                val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(playbackAttributes)
                    .build()
                audioManager?.requestAudioFocus(focusRequest)
            } else {
                @Suppress("DEPRECATION")
                audioManager?.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                )
            }
        } catch (_: Exception) {}
    }

    private fun abandonAudioFocus() {
        try {
            @Suppress("DEPRECATION")
            audioManager?.abandonAudioFocus(null)
        } catch (_: Exception) {}
    }

    fun releasePlayer() {
        stopProgressTracker()
        abandonAudioFocus()
        try {
            if (videoView.isPlaying) {
                videoView.stopPlayback()
            }
        } catch (_: Exception) {}
        isPrepared = false
        lastUri = null
    }

    private fun sendEvent(eventType: String, durationMs: Int, currentPositionMs: Int, errorMessage: String?) {
        val event = Arguments.createMap().apply {
            putString("eventType", eventType)
            putInt("durationMs", durationMs)
            putInt("currentPositionMs", currentPositionMs)
            if (errorMessage != null) {
                putString("errorMessage", errorMessage)
            }
        }
        val reactContext = context as? ReactContext
        reactContext?.getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, "onPlaybackStatus", event)
    }
}

/**
 * ViewManager exposing InAppVideoContainerView to React Native as <InAppVideoView />.
 */
class InAppVideoViewManager : SimpleViewManager<InAppVideoContainerView>() {

    override fun getName(): String = "InAppVideoView"

    override fun createViewInstance(reactContext: ThemedReactContext): InAppVideoContainerView {
        return InAppVideoContainerView(reactContext)
    }

    @ReactProp(name = "sourceUrl")
    fun setSourceUrl(view: InAppVideoContainerView, sourceUrl: String?) {
        view.setSource(sourceUrl)
    }

    @ReactProp(name = "playWhenReady")
    fun setPlayWhenReady(view: InAppVideoContainerView, playWhenReady: Boolean) {
        view.setPlayWhenReady(playWhenReady)
    }

    @ReactProp(name = "seekToMs")
    fun setSeekToMs(view: InAppVideoContainerView, seekToMs: Int) {
        view.seekTo(seekToMs)
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
        val events = mutableMapOf<String, Any>()
        events["onPlaybackStatus"] = MapBuilder.of("registrationName", "onPlaybackStatus")
        return events
    }

    override fun onDropViewInstance(view: InAppVideoContainerView) {
        super.onDropViewInstance(view)
        view.releasePlayer()
    }
}
