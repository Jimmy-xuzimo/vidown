package top.xuzimo.vidown

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.engine.NativeMedia

/** Uses tools/fixtures.py, not a live account or third-party media. */
@RunWith(AndroidJUnit4::class)
class MediaIntegrationTest {
    private val graph
        get() = ApplicationProvider.getApplicationContext<VidownApplication>().graph

    private val base = "http://10.0.2.2:18763"

    @Test
    fun sandboxHasNoNativeCapabilities() {
        assertEquals(
            "undefined,undefined,undefined,undefined",
            NativeMedia.evaluate("[typeof fetch,typeof std,typeof os,typeof Java].join(',')"),
        )
        assertEquals("42", NativeMedia.evaluate("6*7"))
    }

    @Test fun directDownloadAndPrivateProcessRemux() = runBlocking { verify("/sample.mp4", 2) }

    @Test fun hlsTransportStream() = runBlocking { verify("/hls/index.m3u8", 2) }

    @Test fun hlsFragmentedMp4() = runBlocking { verify("/fmp4/index.m3u8", 2) }

    @Test fun hlsByteRanges() = runBlocking { verify("/range/index.m3u8", 2) }

    @Test fun hlsAes128() = runBlocking { verify("/aes/index.m3u8", 2) }

    @Test fun hlsKeyRotation() = runBlocking { verify("/rotation/index.m3u8", 2) }

    @Test fun hlsDiscontinuity() = runBlocking { verify("/discontinuity/index.m3u8", 2) }

    @Test fun hlsIndependentTracks() = runBlocking { verify("/split/master.m3u8", 2) }

    @Test fun dashIndependentTracks() = runBlocking { verify("/dash/index.mpd", 2) }

    @Test
    fun unavailablePrimaryUsesRegisteredMirrorBeforeCaching(): Unit = runBlocking {
        val a = graph.probe.probe("$base/sample.mp4")
        val original = graph.probe.get(a.id)
        val track =
            original.tracks
                .single()
                .copy(
                    url = "$base/expired",
                    headers = mapOf("Authorization" to "fixture-secret"),
                    fallbacks = listOf("http://10.0.2.2:18764/sample.mp4"),
                )
        val plan = DownloadPlan(asset = original, tracks = listOf(track))
        try {
            val result = graph.downloads.download(plan) { _, _, _ -> }
            assertEquals("http://10.0.2.2:18764/sample.mp4", result.inputs.single())
            assertTrue(
                result.registry.resources.values.all { resource ->
                    resource.headers.keys.none { it.equals("authorization", true) }
                }
            )
            assertTrue(result.cache.cacheSpace > 1000)
        } finally {
            graph.downloads.release(plan.id)
            File(graph.app.noBackupFilesDir, "tasks/${plan.id}").deleteRecursively()
        }
    }

    private suspend fun verify(path: String, expectedTracks: Int) =
        withTimeout(120000) {
            val a = graph.probe.probe(base + path)
            val private = graph.probe.get(a.id)
            val video = private.tracks.firstOrNull { it.track.kind != TrackKind.AUDIO }
            val audio = private.tracks.firstOrNull { it.track.kind == TrackKind.AUDIO }
            val plan = DownloadPlan(asset = private, tracks = listOfNotNull(video, audio))
            val directory = File(graph.app.noBackupFilesDir, "tasks/${plan.id}").apply { mkdirs() }
            try {
                val state = graph.downloads.download(plan) { _, _, _ -> }
                val target = File(directory, "result.mp4")
                val report =
                    graph.processor.process(
                        plan.id,
                        state.inputs,
                        plan.tracks.map { it.track.kind.name },
                        target.path,
                        graph.downloads.input(plan.id),
                    )
                assertTrue(target.length() > 1000)
                assertEquals(expectedTracks, report.getJSONArray("streams").length())
                assertTrue(report.getLong("packets") > 100)
                assertEquals(8.0, report.getDouble("duration"), .3)
                val verify =
                    graph.processor.process(plan.id, listOf(target.path), listOf("MUXED"), "")
                assertEquals(report.getLong("packets"), verify.getLong("packets"))
            } finally {
                graph.downloads.release(plan.id)
                directory.deleteRecursively()
            }
        }

    @Test
    fun loginSessionSharedAndCleared() = runBlocking {
        graph.browser.clear()
        assertEquals(
            403,
            graph.network.request(graph.browser.ref, "$base/auth/sample.mp4").use { it.status },
        )
        val tab = graph.browser.newTab("$base/login")
        withTimeout(30000) {
            while (graph.browser.tabs.value.find { it.id == tab }?.loading != false) delay(100)
            while (!graph.browser.cookies().contains("fixture_login")) delay(100)
        }
        assertEquals(
            200,
            graph.network.request(graph.browser.ref, "$base/auth/sample.mp4").use { it.status },
        )
        withTimeout(30000) {
            while (graph.browser.candidates.value.none { it.tabId == tab }) delay(100)
        }
        val old = graph.browser.ref
        graph.browser.clear()
        assertTrue(runCatching { graph.browser.ensureCurrent(old) }.isFailure)
        assertEquals(
            403,
            graph.network.request(graph.browser.ref, "$base/auth/sample.mp4").use { it.status },
        )
    }

    @Test
    fun requestErrorsRemainSpecific() = runBlocking {
        assertEquals(
            429,
            graph.network.request(graph.browser.ref, "$base/limited").use { it.status },
        )
        assertEquals(
            403,
            graph.network.request(graph.browser.ref, "$base/expired").use { it.status },
        )
    }
}
