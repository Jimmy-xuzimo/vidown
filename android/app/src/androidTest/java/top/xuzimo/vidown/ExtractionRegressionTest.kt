package top.xuzimo.vidown

import androidx.test.core.app.ApplicationProvider
import com.chaquo.python.Python
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import top.xuzimo.vidown.core.*

/** Offline reproductions of the mobile-UA redirect and HTML-as-media regressions. */
class ExtractionRegressionTest {
    private val graph
        get() = ApplicationProvider.getApplicationContext<VidownApplication>().graph

    private val base = "http://10.0.2.2:18763"

    @Test
    fun mediaRefererReachesTheServer(): Unit = runBlocking {
        val headers = mapOf("rEfErEr" to "$base/", "Range" to "bytes=0-0")
        graph.network.request(graph.browser.ref, "$base/headers", headers).use { response ->
            val received = JSONObject(response.body.readBytes().toString(Charsets.UTF_8))
            val values =
                received.keys().asSequence().associate { it.lowercase() to received.getString(it) }
            assertEquals("$base/", values["referer"])
            assertEquals("bytes=0-0", values["range"])
        }
    }

    @Test
    fun cdnRedirectKeepsMediaRangeAndOnlyThePageOrigin(): Unit = runBlocking {
        val headers =
            mapOf(
                "Referer" to "$base/watch?token=private",
                "Range" to "bytes=0-0",
                "Authorization" to "fixture-secret",
                "X-Private-Key" to "fixture-private",
            )
        graph.network.request(graph.browser.ref, "$base/cross-redirect", headers).use { response ->
            val received = JSONObject(response.body.readBytes().toString(Charsets.UTF_8))
            val values =
                received.keys().asSequence().associate { it.lowercase() to received.getString(it) }
            assertEquals("$base/", values["referer"])
            assertEquals("bytes=0-0", values["range"])
            assertFalse(values.containsKey("authorization"))
            assertFalse(values.containsKey("x-private-key"))
        }
    }

    @Test
    fun extractorKeepsDesktopDefaultsAndRequestHeaders(): Unit = runBlocking {
        val asset = graph.probe.probe("$base/desktop-extractor-page")
        assertTrue(asset.tracks.isNotEmpty())
        val source = graph.probe.get(asset.id).tracks.first()
        assertEquals("$base/sample.mp4", source.url)
        assertTrue(
            source.headers.entries.any {
                it.key.equals("User-Agent", true) && !it.value.contains("Android")
            }
        )
    }

    @Test
    fun htmlResponseIsRejectedBeforeItReachesNativeMedia(): Unit = runBlocking {
        val asset = graph.probe.probe("$base/fake-media.mp4")
        val private = graph.probe.get(asset.id)
        val plan = DownloadPlan(asset = private, tracks = private.tracks)
        try {
            val failure = runCatching {
                graph.downloads.download(plan) { _, _, _ -> }
            }.exceptionOrNull()
            assertNotNull(failure)
            assertTrue(failure!!.message.orEmpty().contains("网页"))
        } finally {
            graph.downloads.release(plan.id)
        }
    }

    @Test
    fun mobileEmbedLinksPreservePartAndNullOptionalAudioIsSafe(): Unit = runBlocking {
        graph.probe.probe("$base/desktop-extractor-page")
        val python = Python.getInstance()
        val engine = python.getModule("vidown_engine")
        assertEquals(
            "https://www.bilibili.com/video/BV1NGZtBwELa/?p=2",
            engine
                .callAttr(
                    "normalize_source_url",
                    "https://m.bilibili.com/video/BV1NGZtBwELa?p=2&share_source=copy",
                )
                .toString(),
        )
        assertEquals(
            "https://www.bilibili.com/video/av170001/?p=3",
            engine
                .callAttr(
                    "normalize_source_url",
                    "https://player.bilibili.com/player.html?aid=170001&p=3",
                )
                .toString(),
        )
        val scope = python.getModule("builtins").callAttr("dict")
        python
            .getModule("builtins")
            .callAttr(
                "exec",
                """
                from vidown_engine import _attach_playinfo_mirrors
                for optional in ({}, {'dolby':{'audio':None}}, {'flac':None,'audio':None}):
                    assert _attach_playinfo_mirrors([], {'dash':optional, 'durl':None}) == []
                f = [{'url':'https://media.example/a.m4s'}]
                _attach_playinfo_mirrors(f, {'dash':{'audio':[{'baseUrl':f[0]['url'], 'backupUrl':['https://backup.example/a.m4s','file:///secret']}]}})
                assert f[0]['_vidown_mirrors'] == ['https://backup.example/a.m4s']
                """
                    .trimIndent(),
                scope,
            )
    }
}
