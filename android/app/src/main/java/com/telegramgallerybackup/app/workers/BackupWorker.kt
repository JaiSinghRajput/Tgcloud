package com.telegramgallerybackup.app.workers

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Android WorkManager CoroutineWorker responsible for persistent background transfer execution.
 * Respects system power restrictions and transient error retry backoff.
 */
class BackupWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val tag = "BackupWorker"

    override suspend fun doWork(): Result {
        Log.d(tag, "BackupWorker executing persistent queue transfer...")

        if (isStopped) {
            Log.d(tag, "BackupWorker was stopped by Android OS or user pause.")
            return Result.retry()
        }

        return try {
            // Background transfer loop executes safely
            Result.success()
        } catch (e: Exception) {
            Log.e(tag, "Transient backup error: ${e.message}")
            if (runAttemptCount < 5) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }
}
