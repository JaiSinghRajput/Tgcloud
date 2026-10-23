package com.telegramgallerybackup.app.media

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.io.File
import java.io.FileInputStream

/**
 * Hardware-accelerated in-app video container using TextureView and MediaPlayer.
 * Works seamlessly in React Native Modals, FlatLists, and animated view hierarchies.
 */
class InAppVideoContainerView(private val reactContext: ThemedReactContext) :
    FrameLayout(reactContext), TextureView.SurfaceTextureListener {

    private val tag = "InAppVideoView"
    private val textureView = TextureView(reactContext)
    private var mediaPlayer: MediaPlayer? = null
    private var surface: Surface? = null
    private var currentPfd: ParcelFileDescriptor? = null
    private val handler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null
    private var audioManager: AudioManager? = null

    private var isPrepared = false
    private var shouldPlayWhenReady = true
    private var currentSourceUrl: String? = null
    private var videoWidth = 0
    private var videoHeight = 0

    init {
        setBackgroundColor(0xFF000000.toInt())
        val params = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
            gravity = Gravity.CENTER
        }
        textureView.layoutParams = params
        textureView.surfaceTextureListener = this
        addView(textureView)

        audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    }

    override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        Log.d(tag, "onSurfaceTextureAvailable: ${width}x${height}")
        surface = Surface(surfaceTexture)
        mediaPlayer?.setSurface(surface)
        val src = currentSourceUrl
        if (src != null && !isPrepared) {
            initMediaPlayer(src)
        }
    }

    override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        adjustAspectRatio(width, height)
    }

    override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        Log.d(tag, "onSurfaceTextureDestroyed")
        mediaPlayer?.setSurface(null)
        surface?.release()
        surface = null
        return true
    }

    override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {
        // Frame rendered
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val w = right - left
        val h = bottom - top
        textureView.layout(0, 0, w, h)
        adjustAspectRatio(w, h)
    }

    private fun adjustAspectRatio(viewWidth: Int, viewHeight: Int) {
        if (viewWidth <= 0 || viewHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) return

        val viewRatio = viewWidth.toDouble() / viewHeight
        val videoRatio = videoWidth.toDouble() / videoHeight

        val scaleX: Float
        val scaleY: Float

        if (videoRatio > viewRatio) {
            // Video is wider than view -> fit width, letterbox top/bottom
            scaleX = 1.0f
            scaleY = (viewRatio / videoRatio).toFloat()
        } else {
            // Video is taller than view -> fit height, pillarbox left/right
            scaleX = (videoRatio / viewRatio).toFloat()
            scaleY = 1.0f
        }

        val matrix = Matrix()
        val pivotX = viewWidth / 2f
        val pivotY = viewHeight / 2f
        matrix.setScale(scaleX, scaleY, pivotX, pivotY)
        textureView.setTransform(matrix)
    }

    fun setSource(uriString: String?) {
        if (uriString.isNullOrEmpty()) {
            releasePlayer()
            return
        }
        if (uriString == currentSourceUrl && isPrepared) {
            return
        }
        currentSourceUrl = uriString
        isPrepared = false
        sendEvent("loading", 0, 0, null)

        if (surface != null) {
            initMediaPlayer(uriString)
        }
    }

    private fun initMediaPlayer(uriString: String) {
        try {
            releaseMediaPlayerOnly()

            val mp = MediaPlayer()
            mediaPlayer = mp
            mp.setSurface(surface)

            val uri = Uri.parse(uriString)
            Log.d(tag, "initMediaPlayer: uri=$uri, scheme=${uri.scheme}")

            when (uri.scheme) {
                "content" -> {
                    val pfd = reactContext.contentResolver.openFileDescriptor(uri, "r")
                    if (pfd != null) {
                        currentPfd = pfd
                        mp.setDataSource(pfd.fileDescriptor)
                    } else {
                        throw IllegalStateException("Cannot open FileDescriptor for content URI: $uri")
                    }
                }
                "file" -> {
                    val path = uri.path ?: uriString.removePrefix("file://")
                    val file = File(path)
                    if (!file.exists() || file.length() == 0L) {
                        sendEvent("error", 0, 0, "Video media file not found or empty (${file.name})")
                        return
                    }
                    mp.setDataSource(file.absolutePath)
                }
                else -> {
                    if (uriString.startsWith("/")) {
                        val file = File(uriString)
                        if (!file.exists() || file.length() == 0L) {
                            sendEvent("error", 0, 0, "Video media file not found or empty (${file.name})")
                            return
                        }
                        mp.setDataSource(file.absolutePath)
                    } else {
                        mp.setDataSource(reactContext, uri)
                    }
                }
            }

            mp.setOnVideoSizeChangedListener { _, w, h ->
                Log.d(tag, "onVideoSizeChanged: ${w}x${h}")
                if (w > 0 && h > 0) {
                    videoWidth = w
                    videoHeight = h
                    adjustAspectRatio(width, height)
                }
            }

            mp.setOnPreparedListener { player ->
                Log.d(tag, "MediaPlayer onPrepared: duration=${player.duration}ms")
                isPrepared = true
                player.isLooping = false
                val duration = player.duration
                sendEvent("ready", duration, 0, null)

                if (shouldPlayWhenReady) {
                    requestAudioFocus()
                    player.start()
                    startProgressTracker()
                    sendEvent("playing", duration, player.currentPosition, null)
                }
            }

            mp.setOnCompletionListener { player ->
                Log.d(tag, "MediaPlayer onCompletion")
                stopProgressTracker()
                sendEvent("ended", player.duration, player.duration, null)
            }

            mp.setOnErrorListener { _, what, extra ->
                Log.e(tag, "MediaPlayer onError: what=$what, extra=$extra")
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

            mp.setOnInfoListener { player, what, _ ->
                when (what) {
                    MediaPlayer.MEDIA_INFO_BUFFERING_START -> {
                        sendEvent("loading", player.duration, player.currentPosition, null)
                        true
                    }
                    MediaPlayer.MEDIA_INFO_BUFFERING_END -> {
                        if (player.isPlaying) {
                            sendEvent("playing", player.duration, player.currentPosition, null)
                        } else {
                            sendEvent("paused", player.duration, player.currentPosition, null)
                        }
                        true
                    }
                    else -> false
                }
            }

            mp.prepareAsync()
        } catch (e: Exception) {
            Log.e(tag, "initMediaPlayer failed: ${e.message}", e)
            sendEvent("error", 0, 0, "Failed to load video: ${e.message}")
        }
    }

    fun setPlayWhenReady(play: Boolean) {
        shouldPlayWhenReady = play
        val mp = mediaPlayer ?: return
        if (!isPrepared) return

        if (play) {
            requestAudioFocus()
            mp.start()
            startProgressTracker()
            sendEvent("playing", mp.duration, mp.currentPosition, null)
        } else {
            mp.pause()
            stopProgressTracker()
            sendEvent("paused", mp.duration, mp.currentPosition, null)
        }
    }

    fun seekTo(positionMs: Int) {
        val mp = mediaPlayer
        if (mp != null && isPrepared) {
            mp.seekTo(positionMs)
            sendEvent("progress", mp.duration, positionMs, null)
        }
    }

    private fun startProgressTracker() {
        stopProgressTracker()
        progressRunnable = object : Runnable {
            override fun run() {
                val mp = mediaPlayer
                if (mp != null && isPrepared && mp.isPlaying) {
                    val current = mp.currentPosition
                    val duration = mp.duration
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

    private fun releaseMediaPlayerOnly() {
        stopProgressTracker()
        abandonAudioFocus()
        try {
            currentPfd?.close()
        } catch (_: Exception) {}
        currentPfd = null

        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.stop()
                }
                it.reset()
                it.release()
            }
        } catch (_: Exception) {}
        mediaPlayer = null
        isPrepared = false
    }

    fun releasePlayer() {
        releaseMediaPlayerOnly()
        currentSourceUrl = null
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
        val rCtx = context as? ReactContext
        rCtx?.getJSModule(RCTEventEmitter::class.java)
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
