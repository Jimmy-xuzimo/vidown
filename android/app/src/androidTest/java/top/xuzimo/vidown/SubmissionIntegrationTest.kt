package top.xuzimo.vidown

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import top.xuzimo.vidown.core.*

class SubmissionIntegrationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val vm
        get() = ViewModelProvider(ui.activity)[MainViewModel::class.java]

    private val base = "http://10.0.2.2:18763"

    @Test
    fun oneClickBatchCompletesIndependentTracksAndIsolatesFailure(): Unit = runBlocking {
        vm.graph.queue.awaitRecovery()
        vm.graph.settingsStore.update { it.copy(concurrency = 2) }
        ui.onNodeWithTag("media-input")
            .performTextReplacement(
                "$base/sample.mp4\n$base/split/master.m3u8\n$base/expired\n$base/sample.mp4"
            )
        ui.onNodeWithText("解析并下载", useUnmergedTree = true).performClick()
        ui.waitUntil(90000) {
            vm.submissions.value.size == 3 &&
                vm.submissions.value.all {
                    it.state in
                        setOf(
                            SubmissionState.QUEUED,
                            SubmissionState.FAILED,
                            SubmissionState.SELECTION,
                        )
                }
        }
        assertEquals(2, vm.submissions.value.count { it.state == SubmissionState.QUEUED })
        val failed = vm.submissions.value.single { it.state == SubmissionState.FAILED }
        val ids = vm.submissions.value.mapNotNull { it.taskId }.toSet()
        withTimeout(120000) {
            while (
                vm.graph.database
                    .tasks()
                    .all()
                    .filter { it.id in ids }
                    .count { it.state == TaskState.COMPLETED.name } != 2
            ) {
                val failure =
                    vm.graph.database.tasks().all().firstOrNull {
                        it.id in ids && it.state == TaskState.FAILED.name
                    }
                check(failure == null) { "Download failed: ${failure?.message}" }
                delay(200)
            }
        }
        ui.runOnUiThread { vm.retrySubmission(failed) }
        ui.waitUntil(60000) {
            vm.submissions.value.single { it.id == failed.id }.state == SubmissionState.FAILED
        }
        assertEquals(ids, vm.submissions.value.mapNotNull { it.taskId }.toSet())
        assertTrue(
            vm.graph.database.tasks().all().filter { it.id in ids }.all { it.outputUri != null }
        )
        val file = File(ui.activity.getExternalFilesDir(null), "screenshots/issue2-batch.png")
        file.parentFile!!.mkdirs()
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            file.outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        }
    }

    @Test
    fun simultaneousEnqueueOfSameAssetReturnsOneTask() = runBlocking {
        val asset = vm.graph.probe.probe("$base/sample.mp4")
        val ids = asset.tracks.map { it.id }.toSet()
        val results = coroutineScope {
            (1..4).map { async { vm.graph.queue.enqueue(asset.id, ids, false) } }.awaitAll()
        }
        assertEquals(1, results.distinct().size)
        val id = results.first()
        withTimeout(120000) {
            while (
                vm.graph.database.tasks().get(id)?.state !in
                    setOf(TaskState.COMPLETED.name, TaskState.FAILED.name)
            ) delay(200)
        }
        assertEquals(TaskState.COMPLETED.name, vm.graph.database.tasks().get(id)?.state)
    }
}
