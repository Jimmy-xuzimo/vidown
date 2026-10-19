package top.xuzimo.vidown

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
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
        if (busy.value) return@run
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
                for (url in urls) publish(graph.probe.probeAll(url))
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
        graph.queue.enqueue(asset.id, ids, compatible, audioOnly)
        message.value = "已加入下载队列"
        page.value = 2
    }

    fun update(change: (AppSettings) -> AppSettings) = run { graph.settingsStore.update(change) }

    fun browse(url: String? = null) = run {
        graph.browser.newTab(url)
        page.value = 1
    }
}
