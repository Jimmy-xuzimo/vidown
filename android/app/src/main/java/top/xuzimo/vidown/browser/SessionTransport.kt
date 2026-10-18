package top.xuzimo.vidown.browser

import java.io.Closeable
import java.io.FilterInputStream
import java.io.InputStream
import java.net.URI
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.mozilla.geckoview.*
import top.xuzimo.vidown.core.*

class SessionTransport(private val browser: BrowserRepository) {
    data class Response(
        val status: Int,
        val headers: Map<String, String>,
        val body: InputStream,
        val url: String,
    ) : Closeable {
        override fun close() = body.close()

        fun header(name: String) = headers.entries.firstOrNull { it.key.equals(name, true) }?.value
    }

    private val open = ConcurrentHashMap<String, MutableSet<InputStream>>()
    private val pending = ConcurrentHashMap<String, MutableSet<GeckoResult<WebResponse>>>()
    private val epochs = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicLong>()

    suspend fun request(
        ref: RequestContextRef,
        url: String,
        headers: Map<String, String> = emptyMap(),
        method: String = "GET",
        body: ByteArray? = null,
        taskId: String? = null,
    ): Response =
        withContext(Dispatchers.IO) {
            browser.ensureCurrent(ref)
            val token = taskId?.let {
                epochs.computeIfAbsent(it) { java.util.concurrent.atomic.AtomicLong() }
            }
            val epoch = token?.get()
            val executor = GeckoWebExecutor(browser.runtime())
            var current = normalizeUrl(url)
            var currentMethod = method
            var payload = body
            var safeHeaders =
                headers
                    .filterKeys {
                        !it.equals("cookie", true) &&
                            !it.equals("host", true) &&
                            !it.equals("connection", true) &&
                            !it.equals("content-length", true)
                    }
                    .toMap()
            repeat(11) { hop ->
                browser.ensureCurrent(ref)
                browser.ensureNetworkAccess(current)
                if (token?.get() != epoch) throw kotlinx.coroutines.CancellationException("传输已停止")
                val builder =
                    WebRequest.Builder(current)
                        .method(currentMethod)
                        .cacheMode(WebRequest.CACHE_MODE_NO_STORE)
                safeHeaders.forEach { (key, value) ->
                    require(!value.contains('\r') && !value.contains('\n'))
                    builder.header(key, value)
                }
                payload?.let {
                    builder.body(ByteBuffer.allocateDirect(it.size).put(it).apply { flip() })
                }
                val fetch =
                    withContext(Dispatchers.Main.immediate) {
                        executor.fetch(builder.build(), GeckoWebExecutor.FETCH_FLAGS_NO_REDIRECTS)
                    }
                if (taskId != null)
                    pending.computeIfAbsent(taskId) { ConcurrentHashMap.newKeySet() }.add(fetch)
                val response =
                    try {
                        kotlinx.coroutines.withTimeout(30000) { fetch.awaitGecko() }
                    } finally {
                        if (taskId != null) pending[taskId]?.remove(fetch)
                    }
                if (token?.get() != epoch) {
                    response.body?.close()
                    throw kotlinx.coroutines.CancellationException("传输已停止")
                }
                val responseHeaders = response.headers.toMap()
                val location =
                    responseHeaders.entries.firstOrNull { it.key.equals("location", true) }?.value
                if (response.statusCode in setOf(301, 302, 303, 307, 308) && location != null) {
                    response.body?.close()
                    check(hop < 10) { "重定向次数过多" }
                    val next = normalizeUrl(URI(current).resolve(location).toString())
                    if (origin(next) != origin(current))
                        safeHeaders = safeHeaders.filterKeys {
                            it.equals("accept", true) ||
                                it.equals("accept-language", true) ||
                                it.equals("user-agent", true)
                        }
                    if (URI(current).scheme == "https" && URI(next).scheme == "http")
                        error("拒绝将已加密请求降级到 HTTP")
                    if (
                        response.statusCode == 303 ||
                            (response.statusCode in setOf(301, 302) && currentMethod == "POST")
                    ) {
                        currentMethod = "GET"
                        payload = null
                    }
                    current = next
                } else {
                    browser.ensureCurrent(ref)
                    val stream =
                        object : FilterInputStream(response.body ?: InputStream.nullInputStream()) {
                            override fun close() {
                                try {
                                    super.close()
                                } finally {
                                    if (taskId != null) open[taskId]?.remove(this)
                                }
                            }
                        }
                    if (taskId != null)
                        open.computeIfAbsent(taskId) { ConcurrentHashMap.newKeySet() }.add(stream)
                    if (token?.get() != epoch) {
                        stream.close()
                        throw kotlinx.coroutines.CancellationException("传输已停止")
                    }
                    return@withContext Response(
                        response.statusCode,
                        responseHeaders,
                        stream,
                        current,
                    )
                }
            }
            error("重定向失败")
        }

    fun abort(taskId: String) {
        epochs.remove(taskId)?.incrementAndGet()
        pending.remove(taskId)?.forEach { runCatching { it.cancel() } }
        open.remove(taskId)?.forEach { runCatching { it.close() } }
    }

    fun finish(taskId: String) {
        abort(taskId)
    }

    companion object {
        fun origin(url: String): String {
            val u = URI(url)
            return "${u.scheme.lowercase()}://${u.host.lowercase()}:${if(u.port<0)if(u.scheme=="https")443 else 80 else u.port}"
        }
    }
}
