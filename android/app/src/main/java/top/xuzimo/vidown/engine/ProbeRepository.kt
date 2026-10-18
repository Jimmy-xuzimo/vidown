package top.xuzimo.vidown.engine

import android.content.Context
import android.net.Uri
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import top.xuzimo.vidown.browser.*
import top.xuzimo.vidown.core.*

class ProbeRepository(
    private val context: Context,
    private val browser: BrowserRepository,
    private val transport: SessionTransport,
) {
    private val assets = ConcurrentHashMap<String, PrivateAsset>()
    private val protocols = ProtocolInspector(transport)

    fun get(id: String): PrivateAsset =
        requireNotNull(assets[id]) { "资源已失效，请重新解析" }.also { browser.ensureCurrent(it.context) }

    fun clear() {
        assets.clear()
    }

    suspend fun probe(rawUrl: String? = null, candidateId: String? = null): MediaAsset =
        probeAll(rawUrl, candidateId).single()

    suspend fun probeAll(rawUrl: String? = null, candidateId: String? = null): List<MediaAsset> =
        withContext(Dispatchers.IO) {
            val ref = browser.ref
            val capture = candidateId?.let(browser::captured)
            // A captured CDN file is one representation, not the page's full quality list.
            // Re-extract the owning page with the same browser session before falling back.
            if (capture != null && isFullFormatPage(capture.candidate.pageUrl)) {
                try {
                    return@withContext probeAll(rawUrl = capture.candidate.pageUrl)
                } catch (c: CancellationException) {
                    throw c
                } catch (_: Exception) {
                    browser.ensureCurrent(ref)
                }
            }
            val url = capture?.url ?: normalizeUrl(requireNotNull(rawUrl))
            val headers = capture?.headers.orEmpty()
            val protocol =
                capture?.candidate?.protocol
                    ?: when (Uri.parse(url).path?.substringAfterLast('.')?.lowercase()) {
                        "m3u8" -> Protocol.HLS
                        "mpd" -> Protocol.DASH
                        "mp4",
                        "mkv",
                        "webm",
                        "mp3",
                        "m4a",
                        "flac",
                        "wav",
                        "aac",
                        "ogg" -> Protocol.HTTP
                        else -> null
                    }
            var results =
                if (protocol != null) listOf(protocols.inspect(url, protocol, headers, ref))
                else {
                    val owner = newId()
                    val bridge = PythonTransport(transport, browser, ref, owner)
                    try {
                        if (!Python.isStarted())
                            synchronized(Python::class.java) {
                                if (!Python.isStarted()) Python.start(AndroidPlatform(context))
                            }
                        val result =
                            Python.getInstance()
                                .getModule("vidown_engine")
                                .callAttr("probe", url, bridge)
                                .toString()
                        decodeExtractedResult(result, url, ref)
                    } finally {
                        bridge.closeAll()
                    }
                }
            if (capture != null && isFullFormatPage(capture.candidate.pageUrl)) {
                results = results.map {
                    it.copy(
                        asset =
                            it.asset.copy(
                                warnings =
                                    it.asset.warnings +
                                        "网页完整规格解析未成功，当前仅包含捕获到的源文件。请在浏览器播放后，使用视频页面链接重新解析。"
                            )
                    )
                }
            }
            browser.ensureCurrent(ref)
            results.forEach { assets[it.asset.id] = it }
            results.map { it.asset }
        }

    private fun isFullFormatPage(url: String): Boolean {
        val u = Uri.parse(url)
        if (u.host == "player.bilibili.com" && u.path == "/player.html") return true
        return u.host?.lowercase() in
            setOf("bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv") &&
            (u.host == "b23.tv" ||
                u.path.orEmpty().startsWith("/video/") ||
                u.path.orEmpty().startsWith("/bangumi/play/"))
    }
}
