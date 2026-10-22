package com.telegramgallerybackup.app.media

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Native Android module to scan accessible photos and videos from MediaStore.
 * Groups media by folders and calculates eligible vs excluded byte counts.
 * Uses Dispatchers.IO to guarantee zero UI thread blocking or ANRs.
 */
class MediaScannerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun getName(): String = "MediaScanner"

    @ReactMethod
    fun checkPermissions(promise: Promise) {
        val hasPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val img = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            val vid = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
            val selected = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED
            img || vid || selected
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val img = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            val vid = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
            img && vid
        } else {
            ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
        promise.resolve(hasPermission)
    }

    @ReactMethod
    fun getPermissionStatus(promise: Promise) {
        val status = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val img = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            val vid = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
            val selected = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED
            when {
                img && vid -> "granted"
                selected || img || vid -> "partial"
                else -> "denied"
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val img = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            val vid = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
            when {
                img && vid -> "granted"
                img || vid -> "partial"
                else -> "denied"
            }
        } else {
            val ext = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            if (ext) "granted" else "denied"
        }
        promise.resolve(status)
    }

    @ReactMethod
    fun copyToClipboard(text: String, promise: Promise) {
        try {
            val clipboard = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("TGCloud Recovery", text)
            clipboard.setPrimaryClip(clip)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLIPBOARD_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun savePassphraseImage(passphrase: String, promise: Promise) {
        scope.launch {
            try {
                val width = 1080
                val height = 760
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)

                // Dark Theme Background
                val bgPaint = Paint().apply { color = Color.parseColor("#0a0f0d") }
                canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

                // Header Title
                val headerPaint = Paint().apply {
                    color = Color.parseColor("#34d399")
                    textSize = 46f
                    isAntiAlias = true
                    typeface = Typeface.DEFAULT_BOLD
                }
                canvas.drawText("TG Cloud Recovery Passphrase", 60f, 100f, headerPaint)

                val subPaint = Paint().apply {
                    color = Color.parseColor("#9ca3af")
                    textSize = 28f
                    isAntiAlias = true
                }
                canvas.drawText("Save this securely. Required to decrypt your private Telegram backup.", 60f, 150f, subPaint)

                // Card container
                val cardPaint = Paint().apply { color = Color.parseColor("#121a15") }
                val rectF = RectF(60f, 190f, width - 60f, height - 60f)
                canvas.drawRoundRect(rectF, 24f, 24f, cardPaint)

                // Passphrase Words
                val wordPaint = Paint().apply {
                    color = Color.parseColor("#f9fafb")
                    textSize = 36f
                    isAntiAlias = true
                    typeface = Typeface.MONOSPACE
                }
                val words = passphrase.trim().split(Regex("\\s+"))
                val cols = 3
                val colWidth = (width - 160f) / cols
                for (i in words.indices) {
                    val col = i % cols
                    val row = i / cols
                    val x = 90f + col * colWidth
                    val y = 270f + row * 100f
                    canvas.drawText("${i + 1}. ${words[i]}", x, y, wordPaint)
                }

                val resolver = reactContext.contentResolver
                val contentValues = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, "TGCloud_Recovery_${System.currentTimeMillis()}.png")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/TGCloud")
                        put(MediaStore.Images.Media.IS_PENDING, 1)
                    }
                }

                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { stream ->
                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        contentValues.clear()
                        contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
                        resolver.update(uri, contentValues, null, null)
                    }
                    promise.resolve(uri.toString())
                } else {
                    promise.reject("SAVE_FAILED", "Failed to insert into MediaStore")
                }
            } catch (e: Exception) {
                promise.reject("SAVE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun scanMediaStore(excludedFoldersList: ReadableArray, promise: Promise) {
        val excludedSet = mutableSetOf<String>()
        try {
            for (i in 0 until excludedFoldersList.size()) {
                val folder = excludedFoldersList.getString(i)
                if (folder != null) {
                    excludedSet.add(folder)
                }
            }
        } catch (_: Exception) {
            // Ignore
        }

        // Run heavy MediaStore cursor iteration on background I/O dispatcher to prevent ANR
        scope.launch {
            try {
                val foldersMap = mutableMapOf<String, FolderAccumulator>()
                val mediaItemsArray = Arguments.createArray()

                var totalBytes: Long = 0
                var totalCount: Int = 0
                var eligibleBytes: Long = 0
                var eligibleCount: Int = 0
                var excludedBytes: Long = 0
                var excludedCount: Int = 0

                // 1. Scan Photos
                scanCollection(
                    collectionUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    mediaType = "photo",
                    excludedSet = excludedSet,
                    foldersMap = foldersMap,
                    mediaItemsArray = mediaItemsArray,
                    onItem = { bytes, isExcluded ->
                        totalCount++
                        totalBytes += bytes
                        if (isExcluded) {
                            excludedCount++
                            excludedBytes += bytes
                        } else {
                            eligibleCount++
                            eligibleBytes += bytes
                        }
                    }
                )

                // 2. Scan Videos
                scanCollection(
                    collectionUri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    mediaType = "video",
                    excludedSet = excludedSet,
                    foldersMap = foldersMap,
                    mediaItemsArray = mediaItemsArray,
                    onItem = { bytes, isExcluded ->
                        totalCount++
                        totalBytes += bytes
                        if (isExcluded) {
                            excludedCount++
                            excludedBytes += bytes
                        } else {
                            eligibleCount++
                            eligibleBytes += bytes
                        }
                    }
                )

                // Build folder summaries array
                val foldersArray = Arguments.createArray()
                foldersMap.values.forEach { folder ->
                    val fMap = Arguments.createMap().apply {
                        putString("folderKey", folder.folderKey)
                        putString("displayLabel", folder.displayLabel)
                        putInt("itemCount", folder.itemCount)
                        putDouble("byteSize", folder.byteSize.toDouble())
                        putBoolean("isExcluded", folder.isExcluded)
                    }
                    foldersArray.pushMap(fMap)
                }

                val result = Arguments.createMap().apply {
                    putInt("totalCount", totalCount)
                    putDouble("totalBytes", totalBytes.toDouble())
                    putInt("eligibleCount", eligibleCount)
                    putDouble("eligibleBytes", eligibleBytes.toDouble())
                    putInt("excludedCount", excludedCount)
                    putDouble("excludedBytes", excludedBytes.toDouble())
                    putArray("folders", foldersArray)
                    putArray("items", mediaItemsArray)
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("SCAN_ERROR", "Failed to scan MediaStore: ${e.message}", e)
            }
        }
    }

    private fun scanCollection(
        collectionUri: Uri,
        mediaType: String,
        excludedSet: Set<String>,
        foldersMap: MutableMap<String, FolderAccumulator>,
        mediaItemsArray: com.facebook.react.bridge.WritableArray,
        onItem: (bytes: Long, isExcluded: Boolean) -> Unit
    ) {
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.MediaColumns.RELATIVE_PATH else MediaStore.MediaColumns.DATA,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED
        )

        val sortOrder = "${MediaStore.MediaColumns.DATE_MODIFIED} DESC"

        try {
            reactContext.contentResolver.query(collectionUri, projection, null, null, sortOrder)?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val pathColumn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
                } else {
                    cursor.getColumnIndex(MediaStore.MediaColumns.DATA)
                }
                val mimeColumn = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val modColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idColumn)
                    val name = cursor.getString(nameColumn) ?: "media_$id"
                    val rawPath = if (pathColumn != -1) cursor.getString(pathColumn) ?: "" else ""
                    val mimeType = if (mimeColumn != -1) cursor.getString(mimeColumn) ?: "application/octet-stream" else "application/octet-stream"
                    val sizeBytes = cursor.getLong(sizeColumn)
                    val modifiedAtSec = cursor.getLong(modColumn)
                    val contentUri = ContentUris.withAppendedId(collectionUri, id)

                    val normalizedFolderKey = extractFolderKey(rawPath)
                    val isExcluded = excludedSet.contains(normalizedFolderKey)

                    // Update folder aggregation
                    val folder = foldersMap.getOrPut(normalizedFolderKey) {
                        FolderAccumulator(
                            folderKey = normalizedFolderKey,
                            displayLabel = deriveFolderLabel(normalizedFolderKey),
                            itemCount = 0,
                            byteSize = 0L,
                            isExcluded = isExcluded
                        )
                    }
                    folder.itemCount++
                    folder.byteSize += sizeBytes

                    onItem(sizeBytes, isExcluded)

                    // Add up to 50 preview items to keep payload fast and responsive
                    if (mediaItemsArray.size() < 50) {
                        val itemMap = Arguments.createMap().apply {
                            putString("id", "media-$id")
                            putString("sourceKey", contentUri.toString())
                            putString("mediaType", mediaType)
                            putString("displayName", name)
                            putString("relativePath", rawPath)
                            putString("mimeType", mimeType)
                            putDouble("sizeBytes", sizeBytes.toDouble())
                            putDouble("modifiedAtMs", modifiedAtSec * 1000.0)
                            putBoolean("isExcluded", isExcluded)
                        }
                        mediaItemsArray.pushMap(itemMap)
                    }
                }
            }
        } catch (_: Exception) {
            // Ignore individual query errors
        }
    }

    private fun extractFolderKey(rawPath: String): String {
        if (rawPath.isEmpty()) return "DCIM/Camera"
        val clean = rawPath.replace('\\', '/')
        val trimmed = if (clean.endsWith("/")) clean.dropLast(1) else clean
        val lastSlash = trimmed.lastIndexOf('/')
        return if (lastSlash > 0) trimmed.substring(0, lastSlash) else trimmed
    }

    private fun deriveFolderLabel(folderKey: String): String {
        if (folderKey.isEmpty() || folderKey == "Root") return "Root"
        val clean = folderKey.replace('\\', '/')
        val trimmed = if (clean.endsWith("/")) clean.dropLast(1) else clean
        val lastSlash = trimmed.lastIndexOf('/')
        return if (lastSlash != -1 && lastSlash < trimmed.length - 1) trimmed.substring(lastSlash + 1) else trimmed
    }

    private data class FolderAccumulator(
        val folderKey: String,
        val displayLabel: String,
        var itemCount: Int,
        var byteSize: Long,
        val isExcluded: Boolean
    )
}
