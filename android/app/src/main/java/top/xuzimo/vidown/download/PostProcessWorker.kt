package top.xuzimo.vidown.download

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.*
import java.io.File
import kotlinx.coroutines.*
import top.xuzimo.vidown.*
import top.xuzimo.vidown.core.*

class PostProcessWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        withContext(Dispatchers.IO) {
            val graph = (applicationContext as VidownApplication).graph
            // Persisted WorkManager work can start before the first Activity.
            // Complete the interruption audit before reading a stale MERGING row.
            graph.queue.awaitRecovery()
            val id = inputData.getString("taskId") ?: return@withContext Result.failure()
            val dao = graph.database.tasks()
            val record = dao.get(id) ?: return@withContext Result.failure()
            if (record.state != TaskState.MERGING.name) return@withContext Result.failure()
            try {
                val notification =
                    NotificationCompat.Builder(applicationContext, "downloads")
                        .setSmallIcon(android.R.drawable.stat_sys_download_done)
                        .setContentTitle(record.title)
                        .setContentText("正在合并与检查成品")
                        .setProgress(0, 0, true)
                        .setOngoing(true)
                        .addAction(
                            android.R.drawable.ic_menu_close_clear_cancel,
                            "取消",
                            WorkManager.getInstance(applicationContext)
                                .createCancelPendingIntent(this@PostProcessWorker.id),
                        )
                        .build()
                setForeground(
                    ForegroundInfo(
                        id.hashCode() and 0x0fffffff,
                        notification,
                        if (Build.VERSION.SDK_INT >= 35)
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
                        else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                    )
                )
                val dir = File(applicationContext.noBackupFilesDir, "tasks/$id").apply { mkdirs() }
                val original = File(dir, "original.media")
                var output: File
                var mime: String
                var extension: String
                val destination: String?
                if (original.exists()) {
                    dao.transition(id, TaskState.VERIFYING)
                    val report =
                        graph.processor.process(id, listOf(original.path), listOf("MUXED"), "")
                    val stream = report.getJSONArray("streams")
                    require(stream.length() > 0) { "文件不含有效音视频轨道" }
                    val video =
                        (0 until stream.length()).any {
                            stream.getJSONObject(it).getString("kind") == "VIDEO"
                        }
                    val container = report.optString("container")
                    extension =
                        when {
                            container.contains("matroska") || container.contains("webm") ->
                                if (video) "mkv" else "mka"
                            container.contains("mov") || container.contains("mp4") ->
                                if (video) "mp4" else "m4a"
                            container.contains("mpegts") -> "ts"
                            container == "flac" -> "flac"
                            container == "mp3" -> "mp3"
                            container == "aac" -> "aac"
                            container == "ogg" -> "ogg"
                            container == "wav" -> "wav"
                            else -> error("网页文件容器暂不支持安全导出")
                        }
                    output = original
                    mime = mediaMime(extension)
                    destination = graph.settings.value.directoryUri
                } else {
                    val plan = graph.queue.plan(id)
                    val audioOnly = plan.tracks.all { it.track.kind == TrackKind.AUDIO }
                    val codecs = plan.tracks.map { it.track.codec.orEmpty().lowercase() }
                    extension =
                        if (audioOnly)
                            when {
                                codecs.any { it.contains("flac") } -> "flac"
                                codecs.any { it.contains("mp3") } -> "mp3"
                                codecs.any { it.contains("opus") || it.contains("vorbis") } -> "mka"
                                else -> "m4a"
                            }
                        else if (codecs.any { it.contains("flac") || it.contains("vorbis") }) "mkv"
                        else "mp4"
                    mime =
                        when (extension) {
                            "mp4" -> "video/mp4"
                            "mkv" -> "video/x-matroska"
                            "flac" -> "audio/flac"
                            "mp3" -> "audio/mpeg"
                            "mka" -> "audio/x-matroska"
                            else -> "audio/mp4"
                        }
                    output = File(dir, "merged.$extension")
                    val state = graph.downloads.cached(id)
                    try {
                        graph.processor.process(
                            id,
                            state.inputs,
                            plan.tracks.map { it.track.kind.name },
                            output.path,
                            graph.downloads.input(id),
                        )
                    } catch (t: IllegalStateException) {
                        if (
                            extension !in setOf("mp4", "m4a") ||
                                t.message?.let {
                                    it.contains("此容器") ||
                                        it.contains("保留动态范围") ||
                                        it.contains("规格与源轨不一致")
                                } != true
                        )
                            throw t
                        output.delete()
                        extension = if (audioOnly) "mka" else "mkv"
                        mime = mediaMime(extension)
                        output = File(dir, "merged.$extension")
                        graph.processor.process(
                            id,
                            state.inputs,
                            plan.tracks.map { it.track.kind.name },
                            output.path,
                            graph.downloads.input(id),
                        )
                    }
                    dao.transition(id, TaskState.VERIFYING)
                    val report =
                        graph.processor.process(id, listOf(output.path), listOf("MUXED"), "")
                    plan.asset.asset.duration
                        ?.takeIf { it > 0 }
                        ?.let { duration ->
                            require(
                                kotlin.math.abs(duration - report.getDouble("duration")) <
                                    maxOf(1.0, duration * .01)
                            ) {
                                "成品时长与源信息不一致，请重新解析"
                            }
                        }
                    if (plan.compatible) {
                        val converted = File(dir, "compatible.mp4")
                        top.xuzimo.vidown.engine
                            .CompatibleExporter(applicationContext)
                            .export(output, converted, report)
                        val finalReport =
                            graph.processor.process(id, listOf(converted.path), listOf("MUXED"), "")
                        val streams = finalReport.getJSONArray("streams")
                        for (i in 0 until streams.length()) require(
                            streams.getJSONObject(i).getString("codec") in setOf("h264", "aac")
                        ) {
                            "兼容导出未获得预期编码"
                        }
                        val duration = report.optDouble("duration")
                        val finalDuration = finalReport.optDouble("duration")
                        require(duration <= 0 || kotlin.math.abs(duration - finalDuration) < 1.0) {
                            "兼容导出时长不一致"
                        }
                        output = converted
                        extension = if (audioOnly) "m4a" else "mp4"
                        mime = mediaMime(extension)
                    }
                    destination = plan.directoryUri
                }
                currentCoroutineContext().ensureActive()
                check(dao.get(id)?.state == TaskState.VERIFYING.name) { "任务已停止" }
                val uri = graph.outputs.publish(output, record.title, mime, extension, destination)
                try {
                    currentCoroutineContext().ensureActive()
                    check(dao.get(id)?.state == TaskState.VERIFYING.name)
                    dao.transition(id, TaskState.COMPLETED, output = uri.toString())
                } catch (t: Throwable) {
                    applicationContext.contentResolver.delete(uri, null, null)
                    throw t
                }
                graph.queue.cleanup(id)
                Result.success()
            } catch (c: CancellationException) {
                withContext(NonCancellable) {
                    val old = dao.get(id)
                    if (
                        old != null &&
                            TaskState.valueOf(old.state) in
                                setOf(TaskState.MERGING, TaskState.VERIFYING)
                    )
                        dao.transition(id, TaskState.CANCELLED, "处理已停止")
                    graph.queue.cleanup(id)
                }
                throw c
            } catch (t: Throwable) {
                val old = dao.get(id)
                if (
                    old != null &&
                        TaskState.valueOf(old.state) in
                            setOf(TaskState.MERGING, TaskState.VERIFYING)
                )
                    dao.transition(id, TaskState.FAILED, redact(t.message ?: "成品处理失败"))
                Result.failure()
            }
        }

    private fun mediaMime(ext: String) =
        when (ext) {
            "mp4" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "mka" -> "audio/x-matroska"
            "ts" -> "video/mp2t"
            "flac" -> "audio/flac"
            "mp3" -> "audio/mpeg"
            "aac" -> "audio/aac"
            "ogg" -> "audio/ogg"
            "wav" -> "audio/wav"
            else -> "audio/mp4"
        }
}
