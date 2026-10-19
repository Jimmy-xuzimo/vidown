package top.xuzimo.vidown

import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import top.xuzimo.vidown.core.*

/**
 * Optional network survey: reports failures explicitly; never counts blocked sites as supported.
 */
class SitesNetworkIntegrationTest {
    @Test
    fun publicSitesAndActualSourceBytes(): Unit = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("publicSites") == "true")
        val app = ApplicationProvider.getApplicationContext<VidownApplication>()
        val g = app.graph
        val report = JSONArray()
        val reportFile = File(app.getExternalFilesDir(null), "public-sites.json")
        reportFile.writeText("[]")
        val sources =
            listOf(
                "Bilibili film versions" to
                    "https://www.bilibili.com/bangumi/play/ss231879?theme=movie",
                "Bilibili film episode" to "https://www.bilibili.com/bangumi/play/ep5990057",
                "Bilibili投稿" to "https://www.bilibili.com/video/BV1NGZtBwELa/",
                "Douyin" to "https://www.douyin.com/jingxuan?modal_id=7666811827413601586",
                "X" to "https://x.com/AlanShao111/status/2108406850727076182/video/1",
                "YouTube" to "https://www.youtube.com/watch?v=jNQXAC9IVRw",
                "Vimeo" to "https://vimeo.com/76979871",
            )
        for ((site, url) in sources) {
            val item = JSONObject().put("site", site)
            report.put(item)
            try {
                withTimeout(150000) {
                    val asset = g.probe.probeAll(url).first()
                    item
                        .put("formats", asset.tracks.size)
                        .put("versions", asset.episodes.size)
                        .put("warnings", JSONArray(asset.warnings))
                    if (asset.episodes.isNotEmpty()) {
                        assertEquals(2, asset.episodes.size)
                    } else {
                        assertTrue(asset.tracks.isNotEmpty())
                        val private = g.probe.get(asset.id)
                        val selected =
                            listOfNotNull(
                                private.tracks
                                    .filter { it.track.kind != TrackKind.AUDIO }
                                    .maxByOrNull { it.track.height ?: 0 },
                                private.tracks
                                    .filter { it.track.kind == TrackKind.AUDIO }
                                    .maxByOrNull { it.track.bitrate ?: 0 },
                            )
                        val checks = JSONArray()
                        item.put("media", checks)
                        item.put(
                            "sources",
                            JSONArray(
                                selected.map { t ->
                                    JSONObject()
                                        .put("kind", t.track.kind.name)
                                        .put("fallbacks", t.fallbacks.size)
                                        .put(
                                            "hasUserAgent",
                                            t.headers.keys.any { it.equals("User-Agent", true) },
                                        )
                                }
                            ),
                        )
                        for (track in selected) {
                            val plan = DownloadPlan(asset = private, tracks = listOf(track))
                            try {
                                val resolved = g.downloads.resolveSource(plan, track)
                                g.network
                                    .request(
                                        g.browser.ref,
                                        resolved,
                                        track.headers + ("Range" to "bytes=0-16383"),
                                    )
                                    .use { r ->
                                        val bytes = r.body.readNBytes(16384)
                                        assertTrue("HTTP ${r.status}", r.status in 200..299)
                                        assertTrue(bytes.isNotEmpty())
                                        assertFalse(
                                            r.header("Content-Type").orEmpty().contains("html")
                                        )
                                        checks.put(
                                            JSONObject()
                                                .put("kind", track.track.kind.name)
                                                .put("status", r.status)
                                                .put("bytes", bytes.size)
                                                .put("fallbacks", track.fallbacks.size)
                                        )
                                    }
                            } finally {
                                g.downloads.release(plan.id)
                            }
                        }
                    }
                    item.put("passed", true)
                }
            } catch (t: Throwable) {
                if (t !is Exception && t !is AssertionError) throw t
                item.put("passed", false).put("error", redact(t.toString()).take(2000))
            }
            reportFile.writeText(report.toString(2))
        }
        // This assertion gates the new PGC route. Other sites retain their individual failures.
        assertTrue(report.toString(), report.getJSONObject(0).optBoolean("passed"))
        assertTrue(report.toString(), report.getJSONObject(1).optBoolean("passed"))
    }
}
