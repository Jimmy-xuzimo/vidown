package top.xuzimo.vidown

import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.engine.CompatibleExporter

@RunWith(AndroidJUnit4::class)
class ProductIntegrationTest {
    private val graph
        get() = ApplicationProvider.getApplicationContext<VidownApplication>().graph

    private val base = "http://10.0.2.2:18763"

    @Test
    fun hdrMetadataAndHighResolutionAudioSurviveRemux(): Unit = runBlocking {
        val id = newId()
        val dir = File(graph.app.noBackupFilesDir, "tasks/$id").apply { mkdirs() }
        try {
            val source = File(dir, "hdr.mkv")
            val output = File(dir, "preserved.mkv")
            graph.network.request(graph.browser.ref, "$base/hdr10.mkv").use { r ->
                check(r.status == 200)
                source.outputStream().use { r.body.copyTo(it) }
            }
            val before = graph.processor.process(id, listOf(source.path), listOf("MUXED"), "")
            val after =
                graph.processor.process(id, listOf(source.path), listOf("MUXED"), output.path)
            assertEquals(
                before.getJSONArray("packetHashes").toString(),
                after.getJSONArray("packetHashes").toString(),
            )
            assertEquals(
                before.getJSONArray("streams").toString(),
                after.getJSONArray("streams").toString(),
            )
            val streams = after.getJSONArray("streams")
            assertEquals(16, streams.getJSONObject(0).getInt("colorTransfer"))
            assertEquals(9, streams.getJSONObject(0).getInt("colorPrimaries"))
            assertEquals(96000, streams.getJSONObject(1).getInt("sampleRate"))
            assertEquals(24, streams.getJSONObject(1).getInt("bitDepth"))
            assertTrue(
                runCatching {
                    CompatibleExporter(graph.app).export(output, File(dir, "forbidden.mp4"), after)
                }
                    .isFailure
            )
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun packagedChallengeScriptsAndPromiseOutputWork() = runBlocking {
        graph.probe.probe("$base/page") // Starts the same packaged Python used in extraction.
        val module = com.chaquo.python.Python.getInstance().getModule("vidown_engine")
        assertEquals(
            "{\"answer\":42}\n",
            module
                .callAttr(
                    "evaluate_javascript",
                    "Promise.resolve().then(()=>console.log(JSON.stringify({answer:42})))",
                )
                .toString(),
        )
        val solver = org.json.JSONObject(module.callAttr("check_packaged_solver").toString())
        assertEquals("function", solver.getString("solver"))
        assertEquals(42, solver.getInt("answer"))
    }

    @Test
    fun bundledPythonExtractsWebpageThroughSessionTransport() = runBlocking {
        val asset = withTimeout(90000) { graph.probe.probe("$base/page") }
        assertTrue(asset.tracks.isNotEmpty())
        assertTrue(graph.probe.get(asset.id).tracks.all { it.url.startsWith(base) })
    }

    @Test
    fun userTransferPublishesVerifiedFile() = runBlocking {
        ActivityScenario.launch(MainActivity::class.java).use {
            val asset = graph.probe.probe("$base/sample.mp4")
            val id =
                withContext(Dispatchers.Main) {
                    graph.queue.enqueue(asset.id, asset.tracks.map { it.id }.toSet(), false)
                }
            try {
                val completed =
                    withTimeout(90000) {
                        while (true) {
                            val row = graph.database.tasks().get(id)!!
                            if (row.state == TaskState.FAILED.name) error(row.message ?: "任务失败")
                            if (row.state == TaskState.COMPLETED.name) break
                            delay(200)
                        }
                        graph.database.tasks().get(id)!!
                    }
                assertNotNull(completed.outputUri)
                val bytes =
                    graph.app.contentResolver
                        .openInputStream(android.net.Uri.parse(completed.outputUri))!!
                        .use { it.readBytes() }
                assertTrue(bytes.size > 1000)
                assertTrue(
                    graph.app.contentResolver.delete(
                        android.net.Uri.parse(completed.outputUri),
                        null,
                        null,
                    ) > 0
                )
            } finally {
                graph.queue.cancel(id)
                graph.queue.remove(id)
            }
        }
    }

    @Test
    fun compatibleExportUsesSystemCodecsAndIsVerified() = runBlocking {
        val id = newId()
        val dir = File(graph.app.noBackupFilesDir, "tasks/$id").apply { mkdirs() }
        val original = File(dir, "original.mp4")
        val target = File(dir, "compatible.mp4")
        try {
            graph.network.request(graph.browser.ref, "$base/sample.mp4").use { r ->
                original.outputStream().use { r.body.copyTo(it) }
            }
            val report = graph.processor.process(id, listOf(original.path), listOf("MUXED"), "")
            withTimeout(60000) { CompatibleExporter(graph.app).export(original, target, report) }
            val output = graph.processor.process(id, listOf(target.path), listOf("MUXED"), "")
            assertEquals(2, output.getJSONArray("streams").length())
            assertEquals(report.getDouble("duration"), output.getDouble("duration"), .5)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun remuxPreservesEncodedPackets() = runBlocking {
        val id = newId()
        val dir = File(graph.app.noBackupFilesDir, "tasks/$id").apply { mkdirs() }
        try {
            val source = File(dir, "source.mp4")
            val output = File(dir, "saved.mp4")
            graph.network.request(graph.browser.ref, "$base/sample.mp4").use { r ->
                source.outputStream().use { r.body.copyTo(it) }
            }
            val before = graph.processor.process(id, listOf(source.path), listOf("MUXED"), "")
            val after =
                graph.processor.process(id, listOf(source.path), listOf("MUXED"), output.path)
            assertEquals(
                before.getJSONArray("packetHashes").toString(),
                after.getJSONArray("packetHashes").toString(),
            )
            assertEquals(
                before.getJSONArray("streams").toString(),
                after.getJSONArray("streams").toString(),
            )
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun muxedSourceCanBeSavedAsAudioOnly(): Unit = runBlocking {
        ActivityScenario.launch(MainActivity::class.java).use {
            val asset = graph.probe.probe("$base/sample.mp4")
            val id = graph.queue.enqueue(asset.id, asset.tracks.map { it.id }.toSet(), false, true)
            val dir = File(graph.app.noBackupFilesDir, "tasks/${newId()}").apply { mkdirs() }
            try {
                val row =
                    withTimeout(60000) {
                        while (true) {
                            val row = graph.database.tasks().get(id)!!
                            if (row.state == TaskState.FAILED.name) error(row.message ?: "任务失败")
                            if (row.state == TaskState.COMPLETED.name) break
                            delay(100)
                        }
                        graph.database.tasks().get(id)!!
                    }
                val source = File(dir, "audio.m4a")
                val uri = android.net.Uri.parse(row.outputUri)
                graph.app.contentResolver.openInputStream(uri)!!.use { r ->
                    source.outputStream().use { r.copyTo(it) }
                }
                val report =
                    graph.processor.process(newId(), listOf(source.path), listOf("AUDIO"), "")
                assertEquals(1, report.getJSONArray("streams").length())
                assertEquals(
                    "AUDIO",
                    report.getJSONArray("streams").getJSONObject(0).getString("kind"),
                )
                assertEquals("$base/sample.mp4", graph.queue.source(id))
                graph.app.contentResolver.delete(uri, null, null)
            } finally {
                graph.queue.cancel(id)
                graph.queue.remove(id)
                dir.deleteRecursively()
            }
        }
    }
}
