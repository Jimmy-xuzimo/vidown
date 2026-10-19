package top.xuzimo.vidown.browser

import android.content.Context
import android.net.Uri
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.json.JSONObject
import org.mozilla.geckoview.*
import top.xuzimo.vidown.BuildConfig
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.data.SecretStore

class BrowserRepository(
    private val context: Context,
    private val secrets: SecretStore,
    private val scope: CoroutineScope,
) {
    private var instance: GeckoRuntime? = null
    private val configurationReady = CompletableDeferred<Unit>()
    private val extensionReady = CompletableDeferred<Unit>()
    private val cookiesReady = CompletableDeferred<Unit>()
    private var transportSession: GeckoSession? = null
    private val transportReady = CompletableDeferred<Unit>()
    private var extension: WebExtension? = null
    private var port: WebExtension.Port? = null
    private val sessions = LinkedHashMap<String, GeckoSession>()
    private val webIds = mutableMapOf<Int, String>()
    private val pendingCaptures = ArrayDeque<JSONObject>()
    private val captures = ConcurrentHashMap<String, CapturedResource>()
    private val siteData = mutableMapOf<String, List<String>>()
    private val _tabs = MutableStateFlow<List<BrowserTab>>(emptyList())
    val tabs = _tabs.asStateFlow()
    val activeTab = MutableStateFlow<String?>(null)
    private val _candidates = MutableStateFlow<List<SourceCandidate>>(emptyList())
    val candidates = _candidates.asStateFlow()
    val errors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    @Volatile
    var generation: Long = java.security.SecureRandom().nextLong().and(Long.MAX_VALUE)
        private set

    var onDownload: ((String, WebResponse) -> Unit)? = null
    private val cookieRequests = mutableMapOf<String, CompletableDeferred<String>>()
    private var proxy = "system"
    private val cookieLock = Any()
    @Volatile private var clearing = false
    private var fullScreenExit: (() -> Unit)? = null
    val fullScreen = MutableStateFlow(false)
    val ref
        get() = RequestContextRef("browser", generation)

    fun ensureNetworkAccess(url: String) {
        if (android.os.Build.VERSION.SDK_INT < 37) return
        val host = java.net.URI(url).host.orEmpty().lowercase().trim('[', ']')
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        val local =
            host == "localhost" ||
                host.endsWith(".localhost") ||
                host.endsWith(".local") ||
                host == "::1" ||
                host.startsWith("fe80:") ||
                host.startsWith("fc") && host.contains(':') ||
                host.startsWith("fd") && host.contains(':') ||
                parts.size == 4 &&
                    (parts[0] in setOf(0, 10, 127) ||
                        parts[0] == 192 && parts[1] == 168 ||
                        parts[0] == 172 && parts[1] in 16..31 ||
                        parts[0] == 169 && parts[1] == 254)
        if (local)
            check(
                context.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                "访问局域网媒体需要系统授权，请在设置中选择“允许访问局域网媒体”"
            }
    }

    data class CapturedResource(
        val candidate: SourceCandidate,
        val url: String,
        val headers: Map<String, String>,
        val manifest: String?,
    )

    suspend fun runtime(): GeckoRuntime =
        withContext(Dispatchers.Main.immediate) {
            awaitReady(configurationReady, "网络设置")
            val runtime =
                instance
                    ?: GeckoRuntime.create(
                            context,
                            GeckoRuntimeSettings.Builder()
                                .remoteDebuggingEnabled(BuildConfig.DEBUG)
                                .consoleOutput(false)
                                .build(),
                        )
                        .also {
                            instance = it
                            it.webExtensionController
                                // Install the packaged observer on each runtime start. Keeping an
                                // older same-version observer would break the native message
                                // contract
                                // after an app upgrade; browser site storage is not extension
                                // storage.
                                .installBuiltIn("resource://android/assets/media-capture/")
                                .accept(
                                    { ext ->
                                        if (ext == null) {
                                            extensionReady.completeExceptionally(
                                                IllegalStateException("浏览器探测组件不可用")
                                            )
                                            return@accept
                                        }
                                        extension = ext
                                        ext.setMessageDelegate(
                                            object : WebExtension.MessageDelegate {
                                                override fun onConnect(p: WebExtension.Port) {
                                                    port = p
                                                    p.setDelegate(
                                                        object : WebExtension.PortDelegate {
                                                            override fun onPortMessage(
                                                                message: Any,
                                                                port: WebExtension.Port,
                                                            ) {
                                                                (message as? JSONObject)?.let {
                                                                    receive(it, null)
                                                                }
                                                            }

                                                            override fun onDisconnect(
                                                                port: WebExtension.Port
                                                            ) {
                                                                if (
                                                                    this@BrowserRepository.port ===
                                                                        port
                                                                )
                                                                    this@BrowserRepository.port =
                                                                        null
                                                            }
                                                        }
                                                    )
                                                    // Native initiation avoids losing a one-shot
                                                    // ready message
                                                    // while Gecko is still attaching the delegate.
                                                    receive(JSONObject().put("kind", "ready"), null)
                                                }

                                                override fun onMessage(
                                                    nativeApp: String,
                                                    message: Any,
                                                    sender: WebExtension.MessageSender,
                                                ): GeckoResult<Any>? {
                                                    (message as? JSONObject)?.let {
                                                        receive(it, sender.session)
                                                    }
                                                    return null
                                                }
                                            },
                                            "vidown",
                                        )
                                        sessions.values.forEach(::attachExtension)
                                        extensionReady.complete(Unit)
                                    },
                                    { error ->
                                        extensionReady.completeExceptionally(
                                            error ?: IllegalStateException("浏览器探测组件启动失败")
                                        )
                                        errors.tryEmit("浏览器探测组件启动失败，请重新打开应用")
                                    },
                                )
                        }
            awaitReady(extensionReady, "浏览器探测组件")
            awaitReady(cookiesReady, "浏览器登录资料")
            // Initialize Gecko's browsing services before the session executor makes its first
            // request.
            if (transportSession == null) {
                val bootstrap = GeckoSession()
                bootstrap.permissionDelegate = permissionDelegate()
                transportSession = bootstrap
                bootstrap.progressDelegate =
                    object : GeckoSession.ProgressDelegate {
                        override fun onPageStop(session: GeckoSession, success: Boolean) {
                            if (success) transportReady.complete(Unit)
                            else
                                transportReady.completeExceptionally(
                                    IllegalStateException("浏览器网络上下文初始化失败")
                                )
                        }
                    }
                bootstrap.open(runtime)
                bootstrap.loadUri("about:blank")
            }
            awaitReady(transportReady, "浏览器网络上下文")
            runtime
        }

    private suspend fun awaitReady(gate: CompletableDeferred<Unit>, label: String) {
        try {
            withTimeout(30000) { gate.await() }
        } catch (t: TimeoutCancellationException) {
            throw IllegalStateException("${label}初始化超时，请重新打开应用", t)
        }
    }

    private fun permissionDelegate() =
        object : GeckoSession.PermissionDelegate {
            override fun onAndroidPermissionsRequest(
                session: GeckoSession,
                permissions: Array<String>?,
                callback: GeckoSession.PermissionDelegate.Callback,
            ) {
                if (
                    !permissions.isNullOrEmpty() &&
                        permissions.all {
                            it == "android.permission.ACCESS_LOCAL_NETWORK" &&
                                context.checkSelfPermission(it) ==
                                    android.content.pm.PackageManager.PERMISSION_GRANTED
                        }
                )
                    callback.grant()
                else callback.reject()
            }
        }

    private fun attachExtension(session: GeckoSession) {
        val ext = extension ?: return
        session.webExtensionController.setMessageDelegate(
            ext,
            object : WebExtension.MessageDelegate {
                override fun onMessage(
                    nativeApp: String,
                    message: Any,
                    sender: WebExtension.MessageSender,
                ): GeckoResult<Any>? {
                    (message as? JSONObject)?.let { receive(it, sender.session) }
                    return null
                }
            },
            "vidown",
        )
    }

    private fun receive(message: JSONObject, session: GeckoSession?) {
        if (message.toString().length > 1_100_000) return
        if (
            message.optString("kind") in
                setOf("capture", "siteData", "cookies", "cookieSnapshot", "cookiesRestored") &&
                (clearing || message.optString("epoch") != generation.toString())
        )
            return
        when (message.optString("kind")) {
            "siteData" -> {
                val tabId = webIds[message.optInt("webTabId", -1)] ?: return
                val tab = _tabs.value.find { it.id == tabId } ?: return
                if (!isDouyinPage(tab.url) || !isDouyinPage(message.optString("url"))) return
                val data = message.optString("data")
                if (data.length !in 2..1_048_576) return
                siteData[tabId] = (siteData[tabId].orEmpty() + data).takeLast(6)
            }
            "identify" ->
                sessions.entries
                    .find { it.value === session }
                    ?.let {
                        val webId = message.optInt("webTabId", -1)
                        if (webId < 0) return
                        webIds[webId] = it.key
                        val waiting = pendingCaptures.filter { m ->
                            m.optInt("webTabId", -1) == webId
                        }
                        pendingCaptures.removeAll(waiting.toSet())
                        waiting.forEach { m -> receive(m, null) }
                    }
            "ready" -> {
                port?.postMessage(
                    JSONObject().put("kind", "epoch").put("value", generation.toString())
                )
                val restoreGeneration = generation
                port?.postMessage(JSONObject().put("kind", "proxy").put("value", proxy))
                scope.launch(Dispatchers.IO) {
                    val backup = runCatching {
                        secrets.get("session-cookies")?.let(::JSONObject)
                    }
                        .getOrNull()
                    val values =
                        if (
                            backup != null &&
                                System.currentTimeMillis() - backup.optLong("at") in 0..604800000L
                        )
                            backup.optJSONArray("cookies")
                        else null
                    if (!clearing && generation == restoreGeneration)
                        withContext(Dispatchers.Main) {
                            port?.postMessage(
                                JSONObject()
                                    .put("kind", "restoreCookies")
                                    .put("epoch", restoreGeneration.toString())
                                    .put("cookies", values ?: org.json.JSONArray())
                            )
                        }
                }
            }
            "cookiesRestored" -> cookiesReady.complete(Unit)
            "cookieSnapshot" ->
                cookieRequests
                    .remove(message.optString("id"))
                    ?.complete(message.optJSONArray("cookies")?.toString() ?: "[]")
            "cookies" -> {
                val atGeneration = generation
                scope.launch(Dispatchers.IO) {
                    synchronized(cookieLock) {
                        if (!clearing && atGeneration == generation)
                            secrets.put(
                                "session-cookies",
                                JSONObject()
                                    .put("at", System.currentTimeMillis())
                                    .put("cookies", message.optJSONArray("cookies"))
                                    .toString(),
                            )
                    }
                }
            }
            "capture" -> {
                val tabId =
                    webIds[message.optInt("webTabId", -1)]
                        ?: run {
                            // Headers can arrive before the content script has associated the tab.
                            message.remove("manifest")
                            pendingCaptures.addLast(message)
                            while (pendingCaptures.size > 20) pendingCaptures.removeFirst()
                            return
                        }
                val tab = _tabs.value.find { it.id == tabId } ?: return
                val url =
                    runCatching { normalizeUrl(message.getString("url")) }.getOrNull() ?: return
                val protocol =
                    runCatching { Protocol.valueOf(message.getString("protocol")) }.getOrNull()
                        ?: return
                val id = sha256("$generation|$tabId|$url")
                val headers =
                    message
                        .optJSONObject("headers")
                        ?.let { h ->
                            h.keys()
                                .asSequence()
                                .filter {
                                    it.matches(
                                        Regex(
                                            "(?i)referer|origin|user-agent|authorization|accept|accept-language|x-[a-z0-9-]+"
                                        )
                                    )
                                }
                                .associateWith { h.optString(it).take(8192) }
                        }
                        .orEmpty()
                val candidate =
                    SourceCandidate(
                        id,
                        tabId,
                        tab.url,
                        Uri.parse(url).host.orEmpty(),
                        protocol,
                        message.optString("contentType").take(200),
                    )
                val old = captures[id]
                // Manifests are fetched in-session by the parser; do not retain hundreds of 1MB
                // copies.
                captures[id] = CapturedResource(candidate, url, headers, null)
                if (old == null) _candidates.value = (_candidates.value + candidate).takeLast(500)
                val visible = _candidates.value.map { it.id }.toSet()
                captures.keys.retainAll(visible)
            }
        }
    }

    suspend fun newTab(url: String? = null, open: Boolean = true): String =
        withContext(Dispatchers.Main.immediate) {
            url?.let { ensureNetworkAccess(normalizeUrl(it)) }
            val runtime = runtime()
            val id = newId()
            // Apply both before opening/navigating, including popup-created sessions.
            val s =
                GeckoSession(
                    GeckoSessionSettings.Builder()
                        .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                        .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                        .build()
                )
            sessions[id] = s
            _tabs.value = _tabs.value + BrowserTab(id)
            activeTab.value = id
            s.contentDelegate =
                object : GeckoSession.ContentDelegate {
                    override fun onTitleChange(session: GeckoSession, title: String?) {
                        update(id) { it.copy(title = title?.take(250) ?: "网页") }
                    }

                    override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                        onDownload?.invoke(id, response) ?: response.body?.close()
                    }

                    override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) {
                        this@BrowserRepository.fullScreen.value = fullScreen
                    }

                    override fun onCrash(session: GeckoSession) {
                        errors.tryEmit("网页进程已停止，请刷新页面")
                    }
                }
            s.navigationDelegate =
                object : GeckoSession.NavigationDelegate {
                    override fun onLoadRequest(
                        session: GeckoSession,
                        request: GeckoSession.NavigationDelegate.LoadRequest,
                    ): GeckoResult<AllowOrDeny>? {
                        val target = Uri.parse(request.uri)
                        if (
                            target.host == "accounts.google.com" &&
                                (target.path.orEmpty().contains("oauth", true))
                        ) {
                            errors.tryEmit("此登录流程要求系统浏览器，请使用工具栏的外部打开功能。系统浏览器的登录状态不能自动导入应用。")
                            return GeckoResult.fromValue(AllowOrDeny.DENY)
                        }
                        if (target.scheme !in setOf("http", "https", "about", "blob", "data"))
                            return GeckoResult.fromValue(AllowOrDeny.DENY)
                        return null
                    }

                    override fun onLocationChange(
                        session: GeckoSession,
                        url: String?,
                        perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                        hasUserGesture: Boolean,
                    ) {
                        update(id) { it.copy(url = url ?: "about:blank") }
                    }

                    override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                        update(id) { it.copy(canGoBack = canGoBack) }
                    }

                    override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) {
                        update(id) { it.copy(canGoForward = canGoForward) }
                    }

                    override fun onNewSession(
                        session: GeckoSession,
                        uri: String,
                    ): GeckoResult<GeckoSession> {
                        val result = GeckoResult<GeckoSession>()
                        scope.launch {
                            val new = newTab(open = false)
                            result.complete(sessions[new])
                        }
                        return result
                    }

                    override fun onLoadError(
                        session: GeckoSession,
                        uri: String?,
                        error: WebRequestError,
                    ): GeckoResult<String>? {
                        errors.tryEmit("网页加载失败，请检查网络或在系统浏览器中打开")
                        return null
                    }
                }
            s.progressDelegate =
                object : GeckoSession.ProgressDelegate {
                    override fun onPageStart(session: GeckoSession, url: String) {
                        siteData.remove(id)
                        update(id) { it.copy(loading = true) }
                    }

                    override fun onPageStop(session: GeckoSession, success: Boolean) {
                        update(id) { it.copy(loading = false) }
                    }
                }
            s.permissionDelegate = permissionDelegate()
            attachExtension(s)
            if (open) s.open(runtime)
            if (s.isOpen) s.setActive(true)
            sessions.filterKeys { it != id }.values.forEach { if (it.isOpen) it.setActive(false) }
            if (url != null) s.loadUri(normalizeUrl(url))
            id
        }

    private fun update(id: String, transform: (BrowserTab) -> BrowserTab) {
        _tabs.value = _tabs.value.map { if (it.id == id) transform(it) else it }
    }

    fun session(id: String?): GeckoSession? = sessions[id]

    fun captured(id: String): CapturedResource = requireNotNull(captures[id]) { "资源已失效，请重新探测" }

    fun navigate(id: String, url: String) {
        val normalized = normalizeUrl(url)
        ensureNetworkAccess(normalized)
        sessions[id]?.loadUri(normalized)
    }

    fun select(id: String) {
        if (sessions.containsKey(id)) {
            activeTab.value = id
            sessions.forEach { (key, session) -> if (session.isOpen) session.setActive(key == id) }
        }
    }

    fun close(id: String) {
        siteData.remove(id)
        sessions.remove(id)?.close()
        webIds.entries.removeAll { it.value == id }
        _tabs.value = _tabs.value.filterNot { it.id == id }
        captures.entries.removeAll { it.value.candidate.tabId == id }
        _candidates.value = _candidates.value.filterNot { it.tabId == id }
        if (activeTab.value == id) {
            activeTab.value = _tabs.value.lastOrNull()?.id
            activeTab.value?.let(::select)
        }
    }

    fun desktop(id: String) {
        val s = sessions[id] ?: return
        val desktop = s.settings.userAgentMode != GeckoSessionSettings.USER_AGENT_MODE_DESKTOP
        s.settings.userAgentMode =
            if (desktop) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP
            else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
        s.settings.viewportMode =
            if (desktop) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP
            else GeckoSessionSettings.VIEWPORT_MODE_MOBILE
        update(id) { it.copy(desktop = desktop) }
        s.reload()
    }

    fun leaveFullScreen() {
        sessions[activeTab.value]?.exitFullScreen()
    }

    /** Wait for public hydration/API responses from the exact requested webpage. */
    suspend fun douyinPageData(url: String): String =
        withContext(Dispatchers.Main.immediate) {
            val identity = douyinVideoId(url) ?: return@withContext "[]"
            val at = ref
            val tab =
                _tabs.value.firstOrNull { douyinVideoId(it.url) == identity }?.id
                    ?: newTab("https://www.douyin.com/video/$identity")
            repeat(60) {
                ensureCurrent(at)
                if (_tabs.value.none { t -> t.id == tab }) return@withContext "[]"
                val values = siteData[tab].orEmpty()
                if (values.any { it.contains("\"$identity\"") })
                    return@withContext "[${values.joinToString(",")}]"
                delay(300)
            }
            "[]"
        }

    suspend fun cookies(): String =
        withContext(Dispatchers.Main.immediate) {
            runtime()
            withTimeout(15000) {
                while (port == null) delay(50)
                val id = newId()
                val reply = CompletableDeferred<String>()
                cookieRequests[id] = reply
                try {
                    port!!.postMessage(JSONObject().put("kind", "cookieSnapshot").put("id", id))
                    reply.await()
                } finally {
                    cookieRequests.remove(id)
                }
            }
        }

    fun setProxy(value: String) {
        proxy = value
        port?.postMessage(JSONObject().put("kind", "proxy").put("value", value))
        configurationReady.complete(Unit)
    }

    fun ensureCurrent(ref: RequestContextRef) {
        check(ref.id == "browser" && ref.generation == generation) { "登录状态已清除，请重新探测" }
    }

    suspend fun clear() =
        withContext(Dispatchers.Main.immediate) {
            clearing = true
            generation++
            cookieRequests.values.forEach { it.cancel() }
            cookieRequests.clear()
            sessions.keys.toList().forEach(::close)
            captures.clear()
            siteData.clear()
            pendingCaptures.clear()
            _candidates.value = emptyList()
            webIds.clear()
            withContext(Dispatchers.IO) {
                synchronized(cookieLock) { secrets.remove("session-cookies") }
            }
            try {
                instance
                    ?.storageController
                    ?.clearData(StorageController.ClearFlags.ALL)
                    ?.awaitGecko()
            } finally {
                clearing = false
                port?.postMessage(
                    JSONObject().put("kind", "epoch").put("value", generation.toString())
                )
                cookiesReady.complete(Unit)
            }
            withContext(Dispatchers.IO) {
                synchronized(cookieLock) { secrets.remove("session-cookies") }
            }
        }
}

@Suppress("UNCHECKED_CAST")
suspend fun <T> GeckoResult<T>.awaitGecko(): T = suspendCancellableCoroutine { c ->
    c.invokeOnCancellation { cancel() }
    withHandler(android.os.Handler(android.os.Looper.getMainLooper()))
        .accept(
            { value ->
                if (c.isActive) c.resume(value as T) else (value as? WebResponse)?.body?.close()
            },
            { e ->
                if (c.isActive) c.resumeWith(Result.failure(e ?: IllegalStateException("浏览器请求失败")))
            },
        )
}
