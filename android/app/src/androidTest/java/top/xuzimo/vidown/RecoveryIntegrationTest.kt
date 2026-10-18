package top.xuzimo.vidown

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import top.xuzimo.vidown.core.*

@RunWith(AndroidJUnit4::class)
class RecoveryIntegrationTest {
    @org.junit.Test
    fun startupAuditInterruptsPersistedPostprocessing(): Unit =
        kotlinx.coroutines.runBlocking {
            val app =
                androidx.test.core.app.ApplicationProvider.getApplicationContext<
                    VidownApplication
                >()
            val graph = app.graph
            graph.queue.awaitRecovery()
            val id = top.xuzimo.vidown.core.newId()
            graph.secrets.put("plan-$id", "stale-private-authorization")
            graph.database
                .tasks()
                .insert(
                    top.xuzimo.vidown.data.TaskEntity(id, "Interrupted fixture", state = "MERGING")
                )
            try {
                val recovered = top.xuzimo.vidown.download.TaskQueue(graph)
                recovered.awaitRecovery()
                org.junit.Assert.assertEquals("INTERRUPTED", graph.database.tasks().get(id)!!.state)
                org.junit.Assert.assertNull(graph.secrets.get("plan-$id"))
            } finally {
                graph.database.tasks().remove(id)
                graph.secrets.remove("plan-$id")
            }
        }

    private val graph
        get() = ApplicationProvider.getApplicationContext<VidownApplication>().graph

    private val base = "http://10.0.2.2:18763"

    @Test
    fun redirectDoesNotForwardOriginCredentials() = runBlocking {
        val headers =
            mapOf(
                "Authorization" to "fixture-secret",
                "X-Private-Key" to "fixture-private",
                "Accept" to "application/json",
            )
        val direct =
            graph.network.request(graph.browser.ref, "$base/headers", headers).use {
                JSONObject(it.body.readBytes().toString(Charsets.UTF_8))
            }
        assertEquals("fixture-secret", direct.getString("Authorization"))
        val redirected =
            graph.network.request(graph.browser.ref, "$base/cross-redirect", headers).use {
                JSONObject(it.body.readBytes().toString(Charsets.UTF_8))
            }
        assertFalse(
            redirected.keys().asSequence().any {
                it.equals("authorization", true) || it.equals("x-private-key", true)
            }
        )
    }

    @Test
    fun maliciousManifestIsRejectedBeforeParsing() = runBlocking {
        val error = runCatching { graph.probe.probe("$base/evil.mpd") }.exceptionOrNull()
        assertNotNull(error)
        assertTrue(error!!.message.orEmpty().contains("实体"))
    }

    @Test
    fun pauseStopsTransmissionAndResumeReusesCompletedSegments() = runBlocking {
        val case = newId()
        val path = "/case/$case/slow/hls/index.m3u8"
        val asset = graph.probe.probe(base + path)
        val private = graph.probe.get(asset.id)
        val plan = DownloadPlan(asset = private, tracks = private.tracks)
        val transfer = async(Dispatchers.IO) { graph.downloads.download(plan) { _, _, _ -> } }
        try {
            withTimeout(20000) {
                while (true) {
                    val state = runCatching { graph.downloads.cached(plan.id) }.getOrNull()
                    val first = "$base/case/$case/slow/hls/index0.ts"
                    val size = state?.registry?.resources?.get(first)?.length?.toLongOrNull()
                    if (size != null && state.cache.isCached(first, 0, size)) break
                    delay(80)
                }
            }
            assertFalse("样本在暂停前已经全部下载完成", transfer.isCompleted)
            graph.downloads.cancel(plan.id)
            runCatching { transfer.await() }
            val bytes = graph.downloads.cached(plan.id).registry.networkBytes.get()
            delay(500)
            assertEquals(
                "暂停后仍在读媒体响应",
                bytes,
                graph.downloads.cached(plan.id).registry.networkBytes.get(),
            )
            graph.downloads.checkResume(plan)
            withTimeout(30000) { graph.downloads.download(plan) { _, _, _ -> } }
            val requests =
                graph.network.request(graph.browser.ref, "$base/requests").use {
                    JSONObject(it.body.readBytes().toString(Charsets.UTF_8))
                }
            val first = requests.getJSONArray("/case/$case/slow/hls/index0.ts")
            assertEquals(
                "已完成的分片被重复下载",
                1,
                (0 until first.length()).count {
                    first.getJSONObject(it).getString("method") == "GET"
                },
            )
            graph.network.request(graph.browser.ref, "$base/case/$case/mutate").close()
            assertTrue("源身份发生变化时仍允许续传", runCatching { graph.downloads.checkResume(plan) }.isFailure)
        } finally {
            graph.downloads.cancel(plan.id)
            transfer.cancelAndJoin()
            graph.downloads.release(plan.id)
            File(graph.app.noBackupFilesDir, "tasks/${plan.id}").deleteRecursively()
        }
    }
}
