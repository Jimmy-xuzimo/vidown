package top.xuzimo.vidown

import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import top.xuzimo.vidown.core.*

/** Explicit opt-in: public source, no account and no full-length download. */
class BilibiliNetworkIntegrationTest {
    @Test
    fun publicPageAndSelectedMediaAreAccessible(): Unit = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("publicBilibili") == "true")
        val app = ApplicationProvider.getApplicationContext<VidownApplication>()
        val g = app.graph
        val urls =
            listOf(
                "https://www.bilibili.com/video/BV1NGZtBwELa/",
                "https://m.bilibili.com/video/BV1NGZtBwELa/",
                "https://b23.tv/BV1NGZtBwELa",
                "https://www.bilibili.com/video/av116075081571954/?p=1",
                "https://player.bilibili.com/player.html?bvid=BV1NGZtBwELa",
                "https://www.bilibili.com/video/BV1GJ411x7h7/",
            )
        val report = JSONArray()
        for (url in urls) {
            val item = JSONObject().put("input", url)
            report.put(item)
            try {
                val asset = g.probe.probe(url)
                item
                    .put("parsed", true)
                    .put(
                        "tracks",
                        JSONArray(
                            asset.tracks.map {
                                JSONObject()
                                    .put("kind", it.kind.name)
                                    .put("protocol", it.protocol.name)
                                    .put("width", it.width)
                                    .put("height", it.height)
                                    .put("codec", it.codec)
                                    .put("label", it.label)
                            }
                        ),
                    )
                val private = g.probe.get(asset.id)
                val selected =
                    listOfNotNull(
                        private.tracks
                            .filter { it.track.kind == TrackKind.VIDEO }
                            .maxByOrNull { it.track.height ?: 0 },
                        private.tracks
                            .filter { it.track.kind == TrackKind.AUDIO }
                            .maxByOrNull { it.track.bitrate ?: 0 },
                    )
                assertEquals(2, selected.size)
                val attempts = JSONArray()
                item.put("media", attempts)
                for (track in selected) {
                    val plan = DownloadPlan(asset = private, tracks = listOf(track))
                    val resolved = g.downloads.resolveSource(plan, track)
                    val check =
                        JSONObject()
                            .put("kind", track.track.kind.name)
                            .put("fallbackCount", track.fallbacks.size)
                    attempts.put(check)
                    val u = java.net.URI(resolved)
                    check.put("mediaHost", u.host)

                    g.network
                        .request(
                            g.browser.ref,
                            resolved,
                            track.headers + ("Range" to "bytes=0-65535"),
                        )
                        .use { r ->
                            val bytes = r.body.readNBytes(65536)
                            check
                                .put("mediaStatus", r.status)
                                .put("mediaBytes", bytes.size)
                                .put("mediaType", r.header("Content-Type"))
                            if (r.header("Content-Type").orEmpty().contains("html")) {
                                check.put("unexpectedHtml", true)
                            }
                            check.put(
                                "mediaHeader",
                                bytes.take(16).joinToString("") { "%02x".format(it) },
                            )
                        }
                }
            } catch (t: Throwable) {
                item.put("parsed", false).put("error", redact(t.stackTraceToString()).take(4000))
            }
            File(app.getExternalFilesDir(null), "public-bilibili.json")
                .writeText(report.toString(2))
        }
        assertTrue(
            report.toString(),
            (0 until report.length()).all {
                val i = report.getJSONObject(it)
                i.optBoolean("parsed") &&
                    i.optJSONArray("media")?.let { checks ->
                        checks.length() == 2 &&
                            (0 until checks.length()).all { index ->
                                val c = checks.getJSONObject(index)
                                c.optInt("mediaStatus") in 200..299 &&
                                    c.optInt("mediaBytes") > 0 &&
                                    !c.optString("mediaType").contains("html")
                            }
                    } == true
            },
        )
    }
}
