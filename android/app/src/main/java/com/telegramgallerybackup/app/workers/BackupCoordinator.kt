package com.telegramgallerybackup.app.workers

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Coordinates persistent background backup transfers via Android WorkManager.
 * Enforces network policies (Wi-Fi only vs cellular), charging preferences,
 * and handles pause/resume and stale-job reconciliation.
 */
class BackupCoordinator(private val context: Context) {

    companion object {
        const val UNIQUE_BACKUP_WORK_NAME = "com.telegramgallerybackup.work.BACKUP_QUEUE"
    }

    private val workManager by lazy { WorkManager.getInstance(context) }

    /**
     * Enqueues persistent backup work subject to network and charging constraints.
     */
    fun scheduleBackup(wifiOnly: Boolean = true, requiresCharging: Boolean = false) {
        val networkType = if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(networkType)
            .setRequiresCharging(requiresCharging)
            .build()

        val request = OneTimeWorkRequestBuilder<BackupWorker>()
            .setConstraints(constraints)
            .setInitialDelay(500, TimeUnit.MILLISECONDS)
            .addTag("telegram_gallery_backup")
            .build()

        workManager.enqueueUniqueWork(
            UNIQUE_BACKUP_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    /**
     * Pauses backup execution by cancelling queued work.
     * Invariant: Persisted SQLite queue records are preserved; only active execution pauses.
     */
    fun pauseBackup() {
        workManager.cancelUniqueWork(UNIQUE_BACKUP_WORK_NAME)
    }

    /**
     * Resumes backup execution with existing or updated policy constraints.
     */
    fun resumeBackup(wifiOnly: Boolean = true, requiresCharging: Boolean = false) {
        scheduleBackup(wifiOnly, requiresCharging)
    }
}
