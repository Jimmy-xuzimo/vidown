package top.xuzimo.vidown

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import top.xuzimo.vidown.browser.isDouyinPage
import top.xuzimo.vidown.core.*

class MainViewModel(application: Application) : AndroidViewModel(application) {
    val graph = (application as VidownApplication).graph
    val tasks =
        graph.database
            .tasks()
            .observe()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val settings = graph.settings
    val input = MutableStateFlow("")
    val assets = MutableStateFlow<List<MediaAsset>>(emptyList())
    val revealAsset = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)
    val submissions = MutableStateFlow<List<LinkSubmission>>(emptyList())
    private val probeSlots = Semaphore(2)
    private val browserSlot = Semaphore(1)
    private val submissionJobs = mutableMapOf<String, Job>()
    private val enqueuing = mutableSetOf<String>()

    fun submitLinks() {
        if (busy.value) return
        run {
            val urls = mediaLinks(input.value)
            require(submissions.value.size + urls.size <= 200) { "本次会话已提交较多链接，请处理现有任务后重启应用" }
            val active =
                submissions.value
                    .filter {
                        it.state in
                            setOf(
                                SubmissionState.WAITING,
                                SubmissionState.PROBING,
                                SubmissionState.ENQUEUING,
                                SubmissionState.SELECTION,
                            ) ||
                            (it.state == SubmissionState.QUEUED &&
                                tasks.value.any { task ->
                                    task.id == it.taskId &&
                                        TaskTransitions.active(TaskState.valueOf(task.state))
                                })
                    }
                    .map { it.url }
                    .toSet()
            val rows = urls.filterNot { it in active }.map { LinkSubmission(url = it) }
            submissions.update { it + rows }
            rows.forEach(::launchSubmission)
        }
    }

    private fun patchSubmission(id: String, transform: (LinkSubmission) -> LinkSubmission) {
        submissions.update { rows -> rows.map { if (it.id == id) transform(it) else it } }
    }

    private fun launchSubmission(row: LinkSubmission) {
        val job =
            viewModelScope.launch(start = CoroutineStart.LAZY) {
                try {
                    probeSlots.withPermit {
                        patchSubmission(row.id) {
                            it.copy(state = SubmissionState.PROBING, error = null)
                        }
                        suspend fun probe() = graph.probe.probeAll(row.url)
                        val found =
                            if (
                                isDouyinPage(row.url) ||
                                    row.url.contains("t.me/", true) ||
                                    row.url.contains("telegram.org", true)
                            )
                                browserSlot.withPermit { probe() }
                            else probe()
                        currentCoroutineContext().ensureActive()
                        // A multi-result page is a choice, never an implicit playlist download.
                        for (asset in found) {
                            currentCoroutineContext().ensureActive()
                            val ids =
                                if (found.size == 1) automaticTracks(graph.probe.get(asset.id))
                                else null
                            if (ids != null) {
                                patchSubmission(row.id) {
                                    it.copy(state = SubmissionState.ENQUEUING)
                                }
                                withContext(NonCancellable) {
                                    val taskId = graph.queue.enqueue(asset.id, ids, false)
                                    patchSubmission(row.id) {
                                        it.copy(
                                            state = SubmissionState.QUEUED,
                                            title = asset.title,
                                            taskId = taskId,
                                        )
                                    }
                                }
                            } else {
                                assets.update { previous ->
                                    listOf(asset) + previous.filterNot { it.id == asset.id }
                                }
                                patchSubmission(row.id) {
                                    it.copy(
                                        state = SubmissionState.SELECTION,
                                        title = asset.title,
                                        asset = asset,
                                    )
                                }
                            }
                        }
                        require(found.isNotEmpty()) { "没有可保存的媒体" }
                    }
                } catch (c: CancellationException) {
                    patchSubmission(row.id) {
                        if (it.state == SubmissionState.QUEUED) it
                        else it.copy(state = SubmissionState.CANCELLED)
                    }
                    throw c
                } catch (t: Exception) {
                    patchSubmission(row.id) {
                        it.copy(
                            state = SubmissionState.FAILED,
                            error = redact(t.message ?: "解析或入队失败"),
                        )
                    }
                } finally {
                    submissionJobs.remove(row.id)
                }
            }
        submissionJobs[row.id] = job
        job.start()
    }

    fun retrySubmission(row: LinkSubmission) {
        if (row.state != SubmissionState.FAILED || submissionJobs.containsKey(row.id)) return
        patchSubmission(row.id) { it.copy(state = SubmissionState.WAITING, error = null) }
        launchSubmission(row)
    }

    fun cancelSubmission(row: LinkSubmission) {
        if (row.state !in setOf(SubmissionState.WAITING, SubmissionState.PROBING)) return
        submissionJobs[row.id]?.cancel()
    }

    suspend fun clearData(browserData: Boolean, history: Boolean): Int {
        require(submissionJobs.isEmpty() && !busy.value && enqueuing.isEmpty()) {
            "请先等待解析结束或取消解析，再清除本机数据"
        }
        val count = graph.clearData(browserData, history)
        if (browserData) {
            assets.value = emptyList()
            submissions.value = emptyList()
        }
        return count
    }

    val probeError = MutableStateFlow<String?>(null)
    val message = MutableStateFlow<String?>(null)
    val page = MutableStateFlow(0)

    init {
        viewModelScope.launch { graph.browser.errors.collect { message.value = it } }
    }

    fun run(action: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                action()
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                message.value = redact(t.message ?: "操作失败")
            }
        }
    }

    fun probe(candidate: String? = null, sourceUrl: String? = null) = run {
        if (busy.value || submissionJobs.isNotEmpty()) {
            message.value = "请等待当前链接解析结束，或先取消解析"
            return@run
        }
        busy.value = true
        probeError.value = null
        try {
            fun publish(items: List<MediaAsset>) {
                val pages = items.map { it.pageUrl }.toSet()
                assets.update { items + it.filterNot { old -> old.pageUrl in pages } }
                revealAsset.value = items.firstOrNull()?.id
                page.value = 0
            }
            if (candidate != null) publish(graph.probe.probeAll(candidateId = candidate))
            else {
                val urls = mediaLinks(sourceUrl ?: input.value)
                for (url in urls) {
                    try {
                        publish(graph.probe.probeAll(url))
                    } catch (c: CancellationException) {
                        throw c
                    } catch (t: Exception) {
                        probeError.value = redact(t.message ?: "该链接解析失败")
                    }
                }
            }
            page.value = 0
        } catch (c: CancellationException) {
            throw c
        } catch (t: Exception) {
            probeError.value = redact(t.message ?: "暂时无法解析，请重试或在内置浏览器中登录并播放后再解析")
        } finally {
            busy.value = false
        }
    }

    fun enqueue(
        asset: MediaAsset,
        ids: Set<String>,
        compatible: Boolean,
        audioOnly: Boolean = false,
    ) = run {
        if (!enqueuing.add(asset.id)) return@run
        try {
            val taskId = graph.queue.enqueue(asset.id, ids, compatible, audioOnly)
            submissions.update { rows ->
                rows.map {
                    if (it.asset?.id == asset.id)
                        it.copy(state = SubmissionState.QUEUED, taskId = taskId, asset = null)
                    else it
                }
            }
            assets.update { rows -> rows.filterNot { it.id == asset.id } }
            message.value = "已加入下载队列"
            page.value = 2
        } finally {
            enqueuing.remove(asset.id)
        }
    }

    fun update(change: (AppSettings) -> AppSettings) = run { graph.settingsStore.update(change) }

    fun browse(url: String? = null) = run {
        graph.browser.newTab(url)
        page.value = 1
    }
}
