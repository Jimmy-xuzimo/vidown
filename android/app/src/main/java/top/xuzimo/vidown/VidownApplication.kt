package top.xuzimo.vidown

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.work.Configuration
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import top.xuzimo.vidown.browser.*
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.data.*
import top.xuzimo.vidown.download.*
import top.xuzimo.vidown.engine.*

class VidownApplication : Application(), Configuration.Provider {
    val graph: AppGraph by lazy { AppGraph(this) }
    override val workManagerConfiguration: Configuration
        get() =
            Configuration.Builder()
                .setMinimumLoggingLevel(android.util.Log.WARN)
                .setJobSchedulerJobIdRange(10000, 19999)
                .build()

    override fun onCreate() {
        super.onCreate()
        if (getProcessName() == packageName) {
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(
                    NotificationChannel("downloads", "下载与媒体处理", NotificationManager.IMPORTANCE_LOW)
                )
        }
    }
}

class AppGraph(val app: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val database = VidownDatabase.create(app)
    val secrets = SecretStore(app)
    val settingsStore = SettingsStore(app)
    val settings = settingsStore.flow.stateIn(scope, SharingStarted.Eagerly, AppSettings())
    val browser = BrowserRepository(app, secrets, scope)
    val network = SessionTransport(browser)
    val probe = ProbeRepository(app, browser, network)
    val downloads = MediaDownloadEngine(app, network) { settings.value.speedLimitKib }
    val processor = MediaProcessor(app)
    val outputs = OutputStore(app)
    val queue = TaskQueue(this)

    init {
        browser.onDownload = { id, response ->
            scope.launch {
                runCatching { queue.acceptBrowser(id, response) }
                    .onFailure {
                        response.body?.close()
                        browser.errors.tryEmit(redact(it.message ?: "无法保存网页媒体"))
                    }
            }
        }
        // Wait for real persisted settings before allowing the first network request.
        // stateIn's default value is a UI placeholder, not a proxy configuration.
        scope.launch { settingsStore.flow.collect { browser.setProxy(it.proxy) } }
    }

    suspend fun clearData(browserData: Boolean, history: Boolean): Int {
        val tasks = database.tasks().all()
        if (browserData)
            require(tasks.none { TaskTransitions.active(TaskState.valueOf(it.state)) }) {
                "请先完成或取消所有下载和暂停任务，再清除浏览器数据"
            }
        if (browserData) {
            probe.clear()
            browser.clear()
        }
        var removed = 0
        if (history)
            for (task in tasks.filterNot { TaskTransitions.active(TaskState.valueOf(it.state)) }) {
                queue.remove(task.id)
                removed++
            }
        return removed
    }
}
