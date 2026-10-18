package top.xuzimo.vidown.download

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.work.*
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import org.mozilla.geckoview.WebResponse
import top.xuzimo.vidown.AppGraph
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.data.TaskEntity

class TaskQueue(private val graph: AppGraph) {
    private val dao = graph.database.tasks()
    private val jobs = ConcurrentHashMap<String, Job>()
    private val plans = ConcurrentHashMap<String, DownloadPlan>()
    private val external = ConcurrentHashMap<String, WebResponse>()
    private val ready = CompletableDeferred<Unit>()
    private val queueLock = Mutex()
    private var transferring = false

    init {
        graph.scope.launch(Dispatchers.IO) {
            try {
                for (t in dao.all()) if (TaskTransitions.active(TaskState.valueOf(t.state))) {
                    dao.transition(t.id, TaskState.INTERRUPTED, "应用已重新启动，请重新解析链接后下载")
                    graph.secrets.remove("plan-${t.id}")
                }
                ready.complete(Unit)
            } catch (t: Throwable) {
                ready.completeExceptionally(t)
            }
        }
    }

    suspend fun awaitRecovery() = ready.await()

    suspend fun enqueue(
        assetId: String,
        trackIds: Set<String>,
        compatible: Boolean,
        audioOnly: Boolean = false,
    ): String =
        withContext(Dispatchers.IO) {
            ready.await()
            val asset = graph.probe.get(assetId)
            val selected = asset.tracks.filter { it.track.id in trackIds }
            require(selected.size == trackIds.size) { "轨道已失效，请重新解析" }
            val tracks =
                if (audioOnly) {
                    val audio =
                        selected.firstOrNull { it.track.kind == TrackKind.AUDIO }
                            ?: selected.firstOrNull { it.track.kind == TrackKind.MUXED }
                    requireNotNull(audio) { "所选源不含可提取的音频" }
                    listOf(audio.copy(track = audio.track.copy(kind = TrackKind.AUDIO)))
                } else selected
            require(tracks.isNotEmpty()) { "请选择至少一条轨道" }
            require(tracks.none { it.track.kind == TrackKind.MUXED } || tracks.size == 1) {
                "所选源已包含音频，不能再叠加独立音轨"
            }
            require(
                audioOnly ||
                    tracks.none { it.track.kind == TrackKind.VIDEO } ||
                    tracks.any { it.track.kind == TrackKind.AUDIO } ||
                    asset.tracks.none { it.track.kind == TrackKind.AUDIO }
            ) {
                "该视频不含音频，请同时选择一个音轨"
            }
            require(
                tracks.count { it.track.kind != TrackKind.AUDIO } <= 1 &&
                    tracks.count { it.track.kind == TrackKind.AUDIO } <= 1
            ) {
                "每个任务最多选择一个视频轨和一个音频轨"
            }
            if (compatible)
                require(tracks.none { it.track.dynamicRange?.let { d -> d != "SDR" } == true }) {
                    "该规格没有安全的动态范围转换策略，请保留原画质"
                }
            val plan =
                DownloadPlan(
                    asset = asset,
                    tracks = tracks,
                    compatible = compatible,
                    directoryUri = graph.settings.value.directoryUri,
                )
            graph.secrets.put("source-${plan.id}", asset.asset.pageUrl)
            graph.secrets.put("plan-${plan.id}", Json.encodeToString(plan))
            plans[plan.id] = plan
            queueLock.withLock {
                dao.insert(TaskEntity(plan.id, asset.asset.title))
                check(transferring || schedule()) { "系统暂时无法启动下载，请回到应用后重试" }
            }
            plan.id
        }

    suspend fun acceptBrowser(tabId: String, response: WebResponse) {
        ready.await()
        require(response.body != null) { "网页未提供可保存的文件" }
        val tab = graph.browser.tabs.value.find { it.id == tabId } ?: error("原网页已关闭")
        val id = newId()
        external[id] = response
        graph.secrets.put("source-$id", tab.url)
        queueLock.withLock {
            dao.insert(TaskEntity(id, tab.title, canPause = false))
            check(transferring || schedule()) { "系统暂时无法启动下载，请回到应用后重试" }
        }
    }

    private suspend fun schedule(): Boolean {
        val request =
            NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .apply {
                    if (graph.settings.value.unmeteredOnly)
                        addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                }
                .build()
        val result = runCatching {
            graph.app
                .getSystemService(JobScheduler::class.java)
                .schedule(
                    JobInfo.Builder(
                            TRANSFER_JOB,
                            ComponentName(graph.app, TransferJobService::class.java),
                        )
                        .setUserInitiated(true)
                        .setRequiredNetwork(request)
                        .build()
                )
        }
            .getOrDefault(JobScheduler.RESULT_FAILURE)
        if (result != JobScheduler.RESULT_SUCCESS) {
            for (row in dao.all().filter { it.state == TaskState.QUEUED.name }) dao.transition(
                row.id,
                TaskState.FAILED,
                "系统暂时无法启动下载，请回到应用并重新解析",
            )
            return false
        }
        return true
    }

    suspend fun runTransfers(onFinished: () -> Unit = {}) {
        ready.await()
        queueLock.withLock { transferring = true }
        try {
            while (currentCoroutineContext().isActive) {
                val queued =
                    dao.all()
                        .filter { it.state == TaskState.QUEUED.name }
                        .take(graph.settings.value.concurrency)
                if (queued.isEmpty()) break
                coroutineScope {
                    val batch = queued.map { record ->
                        launch(Dispatchers.IO, start = CoroutineStart.LAZY) { execute(record.id) }
                            .also { jobs[record.id] = it }
                    }
                    batch.forEach { it.start() }
                    batch.joinAll()
                }
            }
        } finally {
            // Serialize the last queue check/jobFinished with enqueuing. A new
            // task after the last SELECT must receive a new UIDT job instead
            // of being stranded behind a stale `transferring` flag.
            val allowReschedule = currentCoroutineContext().isActive
            withContext(NonCancellable) {
                queueLock.withLock {
                    transferring = false
                    onFinished()
                    if (allowReschedule && dao.all().any { it.state == TaskState.QUEUED.name })
                        schedule()
                }
            }
        }
    }

    private suspend fun execute(id: String) {
        try {
            dao.transition(id, TaskState.DOWNLOADING)
            val browserStream = external[id]
            if (browserStream != null) {
                val dir = File(graph.app.noBackupFilesDir, "tasks/$id").apply { mkdirs() }
                val file = File(dir, "original.media")
                val total =
                    browserStream.headers.entries
                        .firstOrNull { it.key.equals("content-length", true) }
                        ?.value
                        ?.toLongOrNull()
                var bytes = 0L
                val start = System.currentTimeMillis()
                var last = 0L
                browserStream.body!!.use { input ->
                    file.outputStream().use { out ->
                        val buffer = ByteArray(128 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buffer)
                            if (n < 0) break
                            out.write(buffer, 0, n)
                            bytes += n
                            graph.downloads.throttleBrowser(n)
                            if (System.currentTimeMillis() - last > 300) {
                                last = System.currentTimeMillis()
                                dao.progress(
                                    id,
                                    bytes,
                                    total,
                                    bytes * 1000 / (last - start).coerceAtLeast(1),
                                )
                            }
                        }
                    }
                }
                external.remove(id)
                if (total != null) check(bytes == total) { "网页文件未完整传输" }
                dao.transition(id, TaskState.MERGING)
            } else {
                val plan = requireNotNull(plans[id]) { "授权已失效，请重新解析" }
                graph.browser.ensureCurrent(plan.asset.context)
                var last = 0L
                graph.downloads.download(plan) { bytes, total, speed ->
                    if (System.currentTimeMillis() - last > 300) {
                        last = System.currentTimeMillis()
                        dao.progress(id, bytes, if (plan.tracks.size == 1) total else null, speed)
                    }
                }
                currentCoroutineContext().ensureActive()
                dao.transition(id, TaskState.MERGING)
            }
            val work =
                OneTimeWorkRequestBuilder<PostProcessWorker>()
                    .setInputData(workDataOf("taskId" to id))
                    .addTag("task-$id")
                    .build()
            WorkManager.getInstance(graph.app)
                .enqueueUniqueWork("task-$id", ExistingWorkPolicy.KEEP, work)
        } catch (c: CancellationException) {
            withContext(NonCancellable) {
                val t = dao.get(id)
                if (t?.state == TaskState.DOWNLOADING.name)
                    dao.transition(id, TaskState.INTERRUPTED, "下载已被系统停止，请重新解析")
            }
            throw c
        } catch (t: Throwable) {
            val old = dao.get(id)
            if (
                old != null &&
                    TaskState.valueOf(old.state) in setOf(TaskState.DOWNLOADING, TaskState.QUEUED)
            )
                dao.transition(id, TaskState.FAILED, redact(t.message ?: "下载失败"))
        } finally {
            jobs.remove(id)
            graph.network.finish(id)
        }
    }

    suspend fun pause(id: String) {
        val t = dao.get(id) ?: return
        require(t.canPause && t.state == TaskState.DOWNLOADING.name) { "此阶段不能暂停" }
        dao.transition(id, TaskState.PAUSED)
        graph.downloads.cancel(id)
        jobs[id]?.cancelAndJoin()
    }

    suspend fun resume(id: String) {
        val t = dao.get(id) ?: return
        require(t.state == TaskState.PAUSED.name)
        val plan = requireNotNull(plans[id]) { "授权已失效，请重新解析" }
        graph.browser.ensureCurrent(plan.asset.context)
        graph.downloads.checkResume(plan)
        queueLock.withLock {
            dao.transition(id, TaskState.QUEUED)
            check(transferring || schedule()) { "系统暂时无法启动下载，请回到应用后重试" }
        }
    }

    suspend fun cancel(id: String) {
        val t = dao.get(id) ?: return
        if (!TaskTransitions.active(TaskState.valueOf(t.state))) return
        dao.transition(id, TaskState.CANCELLED)
        graph.downloads.cancel(id)
        external.remove(id)?.body?.close()
        jobs[id]?.cancelAndJoin()
        WorkManager.getInstance(graph.app).cancelUniqueWork("task-$id")
        if (t.state !in setOf(TaskState.MERGING.name, TaskState.VERIFYING.name)) cleanup(id)
    }

    suspend fun stopTransfers() {
        for ((id, job) in jobs) {
            graph.downloads.cancel(id)
            external.remove(id)?.body?.close()
            job.cancel()
        }
    }

    fun plan(id: String): DownloadPlan =
        requireNotNull(plans[id]) { "任务授权已失效，请重新解析" }
            .also { graph.browser.ensureCurrent(it.asset.context) }

    fun source(id: String): String =
        graph.secrets.get("source-$id")?.let(::normalizeUrl) ?: error("此记录没有可重新解析的网页地址，请从浏览器重新发现媒体")

    suspend fun remove(id: String) {
        val t = dao.get(id) ?: return
        require(!TaskTransitions.active(TaskState.valueOf(t.state))) { "不能删除未结束的任务" }
        dao.remove(id)
        graph.secrets.remove("source-$id")
        cleanup(id)
    }

    fun cleanup(id: String) {
        external.remove(id)?.body?.close()
        plans.remove(id)
        graph.secrets.remove("plan-$id")
        graph.downloads.release(id)
        val root = File(graph.app.noBackupFilesDir, "tasks").canonicalFile
        val target = File(root, id).canonicalFile
        if (target.parentFile == root) target.deleteRecursively()
    }

    companion object {
        const val TRANSFER_JOB = 1001
    }
}
