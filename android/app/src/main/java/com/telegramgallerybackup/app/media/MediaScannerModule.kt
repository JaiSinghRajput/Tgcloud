package com.telegramgallerybackup.app.media

import android.Manifest
import android.content.ContentUris
import android.content.pm.PackageManager
import android.database.Cursor
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
import java.io.File

/**
 * Native Android module to scan accessible photos and videos from MediaStore.
 * Groups media by folders and calculates eligible vs excluded byte counts.
 */
class MediaScannerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MediaScanner"

    @ReactMethod
    fun checkPermissions(promise: Promise) {
        val hasPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val img = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            val vid = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
            img && vid
        } else {
            ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
        promise.resolve(hasPermission)
    }

    @ReactMethod
    fun scanMediaStore(excludedFoldersList: ReadableArray, promise: Promise) {
        try {
            val excludedSet = mutableSetOf<String>()
            for (i in 0 until excludedFoldersList.size()) {
                excludedSet.add(excludedFoldersList.getString(i))
            }

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

        reactContext.contentResolver.query(collectionUri, projection, null, null, sortOrder)?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val pathColumn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
            } else {
                cursor.getColumnIndex(MediaStore.MediaColumns.DATA)
            }
            val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val modColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idColumn)
                val name = cursor.getString(nameColumn) ?: "media_$id"
                val rawPath = if (pathColumn != -1) cursor.getString(pathColumn) ?: "" else ""
                val mimeType = cursor.getString(mimeColumn) ?: "application/octet-stream"
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

                // Add up to 100 preview items to keep payload fast and bounded
                if (mediaItemsArray.size() < 100) {
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
    }

    private fun extractFolderKey(path: String): String {
        val clean = path.trim().replace('\\', '/')
        val dir = if (clean.endsWith("/")) clean.dropLast(1) else File(clean).parent ?: clean
        return if (dir.startsWith("/")) dir.drop(1) else dir
    }

    private fun deriveFolderLabel(folderKey: String): String {
        val parts = folderKey.split('/').filter { it.isNotEmpty() }
        return parts.lastOrNull() ?: "Root"
    }

    private data class FolderAccumulator(
        val folderKey: String,
        val displayLabel: String,
        var itemCount: Int,
        var byteSize: Long,
        val isExcluded: Boolean
    )
}
