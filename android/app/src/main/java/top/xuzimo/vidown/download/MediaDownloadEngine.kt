package top.xuzimo.vidown.download

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.StreamKey
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.*
import androidx.media3.datasource.cache.*
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.dash.offline.DashDownloader
import androidx.media3.exoplayer.hls.offline.HlsDownloader
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import androidx.media3.exoplayer.offline.*
import java.io.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.transform.TransformerFactory
import javax.xml.transform.dom.DOMSource
import javax.xml.transform.stream.StreamResult
import kotlinx.coroutines.*
import org.w3c.dom.Element
import top.xuzimo.vidown.browser.SessionTransport
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.engine.ManifestSafety

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaDownloadEngine(
    private val context: Context,
    private val network: SessionTransport,
    private val speedLimit: () -> Int,
) {
    private val sessions = ConcurrentHashMap<String, CachedTask>()
    private val executor = Executors.newFixedThreadPool(4)
    private val governor = SpeedGovernor()
    private val database by lazy { StandaloneDatabaseProvider(context) }

    suspend fun throttleBrowser(bytes: Int) = governor.consumeSuspending(bytes, speedLimit)

    data class CachedTask(
        val cache: SimpleCache,
        val registry: ResourceRegistry,
        val manifests: MutableMap<String, ByteArray>,
        val downloads: MutableList<Downloader>,
        val inputs: MutableList<String>,
        val resolvedTracks: MutableMap<String, String> = ConcurrentHashMap(),
    )

    suspend fun download(
        plan: DownloadPlan,
        progress: suspend (Long, Long?, Long) -> Unit,
    ): CachedTask =
        withContext(Dispatchers.IO) {
            val state =
                sessions.computeIfAbsent(plan.id) {
                    val dir =
                        File(context.noBackupFilesDir, "tasks/${plan.id}/cache").apply { mkdirs() }
                    CachedTask(
                        SimpleCache(dir, NoOpCacheEvictor(), database),
                        ResourceRegistry(),
                        ConcurrentHashMap(),
                        java.util.Collections.synchronizedList(mutableListOf()),
                        mutableListOf(),
                    )
                }
            state.inputs.clear()
            state.downloads.clear()
            val started = System.currentTimeMillis()
            val initial = state.registry.networkBytes.get()
            for (original in plan.tracks) {
                currentCoroutineContext().ensureActive()
                val t =
                    if (
                        original.track.protocol == Protocol.HTTP && original.fallbacks.isNotEmpty()
                    ) {
                        val resolved =
                            state.resolvedTracks[original.track.id]
                                ?: resolveSource(plan, original).also {
                                    state.resolvedTracks[original.track.id] = it
                                }
                        val safe =
                            if (
                                SessionTransport.origin(resolved) ==
                                    SessionTransport.origin(original.url)
                            )
                                original.headers
                            else
                                original.headers.filterKeys {
                                    it.lowercase() in
                                        setOf(
                                            "referer",
                                            "origin",
                                            "accept",
                                            "accept-language",
                                            "user-agent",
                                        )
                                }
                        original.copy(url = resolved, headers = safe)
                    } else original
                if (t.track.protocol == Protocol.HLS) {
                    val bytes =
                        network
                            .request(plan.asset.context, t.url, t.headers, taskId = plan.id)
                            .use { r ->
                                require(r.status in 200..299)
                                r.body.readNBytes(2 * 1024 * 1024 + 1)
                            }
                    require(bytes.size <= 2 * 1024 * 1024) { "清单过大" }
                    val playlist =
                        HlsPlaylistParser().parse(Uri.parse(t.url), ByteArrayInputStream(bytes))
                    require(playlist is HlsMediaPlaylist && playlist.hasEndTag) {
                        "请选择具体的点播轨道；首版不保存直播或未结束的媒体"
                    }
                    require(playlist.protectionSchemes == null) { "所选媒体使用受保护的加密方式" }
                }
                val upstream = DataSource.Factory {
                    GeckoDataSource(
                        network,
                        plan.asset.context,
                        plan.id,
                        t.headers,
                        state.registry,
                        speedLimit,
                        SessionTransport.origin(t.url),
                        governor,
                    )
                }
                val cache =
                    CacheDataSource.Factory()
                        .setCache(state.cache)
                        .setUpstreamDataSourceFactory(upstream)
                        .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE)
                val item = MediaItem.Builder().setUri(t.url)
                var input = t.url
                if (t.track.protocol == Protocol.DASH) {
                    val body =
                        network
                            .request(plan.asset.context, t.url, t.headers, taskId = plan.id)
                            .use { r ->
                                require(r.status in 200..299)
                                r.body.readNBytes(2 * 1024 * 1024 + 1)
                            }
                    require(body.size <= 2 * 1024 * 1024) { "清单过大" }
                    ManifestSafety.xml(body)
                    val manifest =
                        DashManifestParser().parse(Uri.parse(t.url), ByteArrayInputStream(body))
                    require(!manifest.dynamic) { "不支持直播录制" }
                    require(manifest.periodCount == 1) { "多 Period DASH 尚未通过连续性验证，请选择单个媒体资源" }
                    val keys = mutableListOf<StreamKey>()
                    for (p in 0 until manifest.periodCount) {
                        val period = manifest.getPeriod(p)
                        var found = false
                        period.adaptationSets.forEachIndexed { a, group ->
                            group.representations.forEachIndexed { r, representation ->
                                if (
                                    representation.format.id == t.selector ||
                                        representation.format.id == t.track.id
                                ) {
                                    keys += StreamKey(p, a, r)
                                    found = true
                                }
                            }
                        }
                        require(found) { "清单中的轨道身份不一致，请重新解析" }
                    }
                    item.setStreamKeys(keys)
                    input =
                        t.url +
                            (if (t.url.contains("?")) "&" else "?") +
                            "__vidown_track=" +
                            sha256(t.track.id).take(16)
                    state.manifests[input] = filteredDash(body, t.selector ?: t.track.id)
                }
                val downloader: Downloader =
                    when (t.track.protocol) {
                        Protocol.HLS -> HlsDownloader(item.build(), cache, executor)
                        Protocol.DASH -> DashDownloader(item.build(), cache, executor)
                        Protocol.HTTP -> ProgressiveDownloader(item.build(), cache, executor)
                        else -> error("网页资源需要在原页面保存")
                    }
                state.downloads += downloader
                state.inputs += input
                try {
                    downloader.download { length, downloaded, _ ->
                        if (!currentThreadActive()) downloader.cancel()
                        val all = state.registry.networkBytes.get()
                        runBlocking {
                            progress(
                                all,
                                length.takeIf { it > 0 },
                                ((all - initial) * 1000 /
                                    (System.currentTimeMillis() - started).coerceAtLeast(1)),
                            )
                        }
                    }
                } catch (e: InterruptedException) {
                    throw CancellationException("下载已停止", e)
                }
            }
            state
        }

    private fun currentThreadActive() = !Thread.currentThread().isInterrupted

    /** Choose before caching begins. Never switch an in-progress stream across CDNs. */
    internal suspend fun resolveSource(plan: DownloadPlan, track: PrivateTrack): String {
        var status: Int? = null
        for (url in (listOf(track.url) + track.fallbacks.take(8)).distinct()) {
            currentCoroutineContext().ensureActive()
            val scoped =
                if (SessionTransport.origin(url) == SessionTransport.origin(track.url))
                    track.headers
                else
                    track.headers.filterKeys {
                        it.lowercase() in
                            setOf("referer", "origin", "user-agent", "accept", "accept-language")
                    }
            try {
                network
                    .request(
                        plan.asset.context,
                        url,
                        scoped + ("Range" to "bytes=0-0"),
                        taskId = plan.id,
                    )
                    .use {
                        status = it.status
                        if (
                            it.status in setOf(200, 206) &&
                                !it.header("Content-Type").orEmpty().contains("html", true)
                        )
                            return url
                    }
            } catch (c: CancellationException) {
                throw c
            } catch (_: Exception) {
                /* Try the next registered CDN before any bytes are cached. */
            }
        }
        error("源地址及备用 CDN 均不可用${status?.let { "（HTTP $it）" }.orEmpty()}，请重新解析")
    }

    suspend fun checkResume(plan: DownloadPlan) {
        val state = requireNotNull(sessions[plan.id]) { "检查点已失效，请重新解析" }
        for ((url, old) in state.registry.resources) {
            val etag = old.etag ?: error("源站没有提供可靠身份标记，此任务需重新下载")
            val headers = old.headers
            network.request(plan.asset.context, url, headers, "HEAD", taskId = plan.id).use { r ->
                require(r.status in 200..299 && r.header("etag") == etag) { "媒体源已变化，已阻止续传" }
            }
        }
    }

    fun cancel(id: String) {
        sessions[id]?.downloads?.forEach { it.cancel() }
        network.abort(id)
    }

    fun cached(id: String) = requireNotNull(sessions[id]) { "下载缓存不可用" }

    fun input(id: String) = CachedInput(cached(id))

    fun release(id: String) {
        sessions.remove(id)?.let { s ->
            s.downloads.forEach { runCatching { it.cancel() } }
            runCatching { s.cache.release() }
        }
        network.finish(id)
    }

    private fun filteredDash(bytes: ByteArray, id: String): ByteArray {
        ManifestSafety.xml(bytes)
        val factory =
            DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                isExpandEntityReferences = false
            }
        val builder = factory.newDocumentBuilder()
        builder.setEntityResolver { _, _ -> throw org.xml.sax.SAXException("拒绝外部实体") }
        val document = builder.parse(ByteArrayInputStream(bytes))
        val reps = document.getElementsByTagNameNS("*", "Representation")
        (0 until reps.length)
            .map { reps.item(it) as Element }
            .filter { it.getAttribute("id") != id }
            .forEach { it.parentNode.removeChild(it) }
        val groups = document.getElementsByTagNameNS("*", "AdaptationSet")
        (0 until groups.length)
            .map { groups.item(it) as Element }
            .filter { it.getElementsByTagNameNS("*", "Representation").length == 0 }
            .forEach { it.parentNode.removeChild(it) }
        return ByteArrayOutputStream()
            .also {
                TransformerFactory.newInstance()
                    .newTransformer()
                    .transform(DOMSource(document), StreamResult(it))
            }
            .toByteArray()
    }

    /** Cache-only reader used by JNI. It can never fall through to the network. */
    class CachedInput(private val state: CachedTask) {
        private data class Handle(val stream: InputStream, val size: Long)

        private val readers = ConcurrentHashMap<Long, Handle>()
        private val next = java.util.concurrent.atomic.AtomicLong()

        fun open(raw: String, position: Long, key: String?, iv: String?): Long {
            val url = raw.removePrefix("crypto+").removePrefix("crypto:")
            require(state.registry.resources.containsKey(url) || state.manifests.containsKey(url)) {
                "合并请求了未登记资源"
            }
            val override = state.manifests[url]
            val data: InputStream
            var length: Long
            if (override != null) {
                data = ByteArrayInputStream(override)
                length = override.size.toLong()
            } else {
                val source =
                    CacheDataSource.Factory()
                        .setCache(state.cache)
                        .setUpstreamDataSourceFactory(null)
                        .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE)
                        .createDataSource()
                length = source.open(DataSpec.Builder().setUri(url).build())
                data =
                    object : InputStream() {
                        override fun read(): Int {
                            val b = ByteArray(1)
                            return if (read(b, 0, 1) < 0) -1 else b[0].toInt() and 255
                        }

                        override fun read(b: ByteArray, off: Int, len: Int) =
                            source.read(b, off, len)

                        override fun close() = source.close()
                    }
            }
            var stream = data
            if (!key.isNullOrEmpty() && !iv.isNullOrEmpty()) {
                fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                val cipher =
                    Cipher.getInstance("AES/CBC/PKCS5Padding").apply {
                        init(
                            Cipher.DECRYPT_MODE,
                            SecretKeySpec(hex(key), "AES"),
                            IvParameterSpec(hex(iv)),
                        )
                    }
                stream = CipherInputStream(data, cipher)
                length = -1
            }
            var skip = position
            while (skip > 0) {
                val moved = stream.skip(skip)
                if (moved <= 0) {
                    if (stream.read() < 0) break
                    skip--
                } else skip -= moved
            }
            require(skip == 0L) { "缓存字节范围不完整" }
            val id = next.incrementAndGet()
            readers[id] = Handle(stream, length)
            return id
        }

        fun read(id: Long, size: Int): ByteArray {
            require(size in 1..262144)
            val out = ByteArray(size)
            val n = requireNotNull(readers[id]).stream.read(out)
            return if (n < 0) ByteArray(0) else out.copyOf(n)
        }

        fun size(id: Long) = readers[id]?.size ?: -1

        fun close(id: Long) {
            readers.remove(id)?.stream?.close()
        }

        fun closeAll() {
            readers.keys.toList().forEach(::close)
        }
    }
}
