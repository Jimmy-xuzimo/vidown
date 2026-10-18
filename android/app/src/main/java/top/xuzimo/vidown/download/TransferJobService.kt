package top.xuzimo.vidown.download

import android.app.*
import android.app.job.*
import android.content.Intent
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import top.xuzimo.vidown.*

class TransferJobService : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var observer: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        val launch =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val notification =
            NotificationCompat.Builder(this, "downloads")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Vidown 正在下载")
                .setContentText("打开应用查看进度、暂停或取消")
                .setContentIntent(launch)
                .setOngoing(true)
                .setProgress(0, 0, true)
                .build()
        setNotification(params, 1001, notification, JOB_END_NOTIFICATION_POLICY_REMOVE)
        val graph = (application as VidownApplication).graph
        observer = scope.launch {
            graph.database.tasks().observe().collect { tasks ->
                val active = tasks.firstOrNull { it.state == "DOWNLOADING" }
                if (active != null) {
                    fun action(name: String) =
                        PendingIntent.getBroadcast(
                            this@TransferJobService,
                            (active.id + name).hashCode(),
                            Intent(this@TransferJobService, TransferActionReceiver::class.java)
                                .setAction(name)
                                .putExtra("task", active.id),
                            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                        )
                    val total = active.total
                    val updated =
                        NotificationCompat.Builder(this@TransferJobService, "downloads")
                            .setSmallIcon(android.R.drawable.stat_sys_download)
                            .setContentTitle(active.title)
                            .setContentText(
                                "已下载 ${active.bytes/1024} KB · ${active.speed/1024} KB/s"
                            )
                            .setContentIntent(launch)
                            .setOngoing(true)
                            .setOnlyAlertOnce(true)
                            .setProgress(
                                100,
                                if (total != null && total > 0)
                                    (100 * active.bytes / total).toInt().coerceIn(0, 100)
                                else 0,
                                total == null,
                            )
                    if (active.canPause)
                        updated.addAction(android.R.drawable.ic_media_pause, "暂停", action("pause"))
                    updated.addAction(
                        android.R.drawable.ic_menu_close_clear_cancel,
                        "取消",
                        action("cancel"),
                    )
                    setNotification(
                        params,
                        1001,
                        updated.build(),
                        JOB_END_NOTIFICATION_POLICY_REMOVE,
                    )
                }
            }
        }
        job = scope.launch {
            try {
                graph.queue.runTransfers {
                    observer?.cancel()
                    jobFinished(params, false)
                }
            } finally {
                observer?.cancel()
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        observer?.cancel()
        job?.cancel()
        scope.launch { (application as VidownApplication).graph.queue.stopTransfers() }
        return false
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
