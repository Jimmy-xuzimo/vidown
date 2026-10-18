package top.xuzimo.vidown.download

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.*
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.runBlocking
import top.xuzimo.vidown.browser.SessionTransport
import top.xuzimo.vidown.core.*

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class GeckoDataSource(
    private val transport: SessionTransport,
    private val ref: RequestContextRef,
    private val taskId: String,
    private val headers: Map<String, String>,
    private val registry: ResourceRegistry,
    private val speedLimit: () -> Int,
    private val credentialOrigin: String,
    private val governor: SpeedGovernor,
) : BaseDataSource(true) {
    private var response: SessionTransport.Response? = null
    private var uri: Uri? = null
    private var left = C.LENGTH_UNSET.toLong()
    private var started = 0L
    private var bytes = 0L

    override fun open(spec: DataSpec): Long {
        transferInitializing(spec)
        uri = spec.uri
        val sameOrigin = SessionTransport.origin(spec.uri.toString()) == credentialOrigin
        val scoped =
            if (sameOrigin) headers
            else
                headers.filterKeys {
                    it.lowercase() in
                        setOf("accept", "accept-language", "user-agent", "referer", "origin")
                }
        val requestHeaders =
            scoped +
                spec.httpRequestHeaders.filterKeys {
                    sameOrigin || it.lowercase() in setOf("range", "accept", "user-agent")
                } +
                buildMap {
                    if (spec.position > 0 || spec.length != C.LENGTH_UNSET.toLong())
                        put(
                            "Range",
                            "bytes=${spec.position}-${if(spec.length==C.LENGTH_UNSET.toLong())"" else spec.position+spec.length-1}",
                        )
                }
        val result = runBlocking {
            transport.request(
                ref,
                normalizeUrl(spec.uri.toString()),
                requestHeaders,
                taskId = taskId,
            )
        }
        response = result
        if (result.status == 416 && spec.length == C.LENGTH_UNSET.toLong()) {
            val size =
                Regex("bytes \\*/(\\d+)")
                    .matchEntire(result.header("content-range").orEmpty())
                    ?.groupValues
                    ?.get(1)
                    ?.toLongOrNull()
            if (size == spec.position) {
                // CacheWriter can reopen exactly at EOF when a playlist reuses
                // a fully cached URI whose length was initially unknown.
                left = 0
                transferStarted(spec)
                return 0
            }
        }
        if (result.status !in 200..299 || (spec.position > 0 && result.status != 206)) {
            result.close()
            throw IOException("媒体请求失败（HTTP ${result.status}），服务器未提供所需范围或登录已失效")
        }
        if (result.header("Content-Type").orEmpty().contains("html", true)) {
            result.close()
            throw IOException("源站返回了网页，未返回媒体文件。请重新解析；需要登录时先在内置浏览器登录并播放")
        }
        if (result.status == 206) {
            val range = result.header("content-range")
            if (range == null || !range.startsWith("bytes ${spec.position}-")) {
                result.close()
                throw IOException("服务器返回了错误的字节范围")
            }
        }
        registry.observe(
            spec.uri.toString(),
            result.header("etag"),
            result.header("content-length"),
            result.header("content-range"),
            requestHeaders,
        )
        left =
            if (spec.length != C.LENGTH_UNSET.toLong()) spec.length
            else result.header("content-length")?.toLongOrNull() ?: C.LENGTH_UNSET.toLong()
        started = System.nanoTime()
        bytes = 0
        transferStarted(spec)
        return left
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (left == 0L) return C.RESULT_END_OF_INPUT
        val n =
            requireNotNull(response)
                .body
                .read(
                    buffer,
                    offset,
                    if (left < 0) length else minOf(length.toLong(), left).toInt(),
                )
        if (n < 0) {
            if (left > 0) throw IOException("媒体响应提前结束")
            return C.RESULT_END_OF_INPUT
        }
        if (left > 0) left -= n
        bytes += n
        registry.networkBytes.addAndGet(n.toLong())
        bytesTransferred(n)
        governor.consume(n, speedLimit)
        return n
    }

    override fun getUri(): Uri? = uri

    override fun getResponseHeaders(): Map<String, List<String>> =
        response?.headers?.mapValues { listOf(it.value) }.orEmpty()

    override fun close() {
        if (response != null) {
            runCatching { response?.close() }
            response = null
            transferEnded()
        }
    }
}

class ResourceRegistry {
    data class Fingerprint(
        val etag: String?,
        val length: String?,
        val range: String?,
        val headers: Map<String, String>,
    )

    val resources = ConcurrentHashMap<String, Fingerprint>()
    val networkBytes = java.util.concurrent.atomic.AtomicLong()

    fun observe(
        url: String,
        etag: String?,
        length: String?,
        range: String?,
        headers: Map<String, String>,
    ) {
        val before = resources[url]
        if (before?.etag != null && etag != before.etag) error("媒体源已变化，已阻止拼接不同内容")
        resources[url] =
            Fingerprint(etag?.takeUnless { it.startsWith("W/") }, length, range, headers)
    }
}

/** Shared across all fragments and tasks, with interruptible waits. */
class SpeedGovernor {
    private var next = 0L
    private var lastLimit = 0

    suspend fun consumeSuspending(bytes: Int, setting: () -> Int) {
        val limit = setting()
        if (limit <= 0) return
        val until = reserve(bytes, limit)
        while (setting() == limit) {
            val wait = until - System.nanoTime()
            if (wait <= 0) return
            kotlinx.coroutines.delay((wait / 1_000_000).coerceIn(1, 200))
        }
    }

    private fun reserve(bytes: Int, limit: Int): Long =
        synchronized(this) {
            val now = System.nanoTime()
            if (limit != lastLimit) {
                next = now
                lastLimit = limit
            }
            next = maxOf(next, now) + bytes * 1_000_000_000L / (limit * 1024L)
            next
        }

    fun consume(bytes: Int, setting: () -> Int) {
        val limit = setting()
        if (limit <= 0) {
            synchronized(this) {
                next = 0
                lastLimit = 0
            }
            return
        }
        val until = reserve(bytes, limit)
        while (setting() == limit) {
            val wait = until - System.nanoTime()
            if (wait <= 0) return
            Thread.sleep((wait / 1_000_000).coerceIn(1, 200))
        }
    }
}
