package top.xuzimo.vidown

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.mozilla.geckoview.GeckoView
import top.xuzimo.vidown.browser.awaitGecko
import top.xuzimo.vidown.core.TaskState

class InterfaceIntegrationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Before
    fun configureRequestedLayout() {
        val args = InstrumentationRegistry.getArguments()
        val target =
            when {
                args.getString("vidownLandscape") == "true" ->
                    android.content.res.Configuration.ORIENTATION_LANDSCAPE
                args.getString("vidownPortrait") == "true" ->
                    android.content.res.Configuration.ORIENTATION_PORTRAIT
                else -> return
            }
        val currentRotation = ui.activity.display?.rotation ?: 0
        val rotation =
            if (ui.activity.resources.configuration.orientation == target) currentRotation
            else (currentRotation + 1) % 4
        assertTrue(InstrumentationRegistry.getInstrumentation().uiAutomation.setRotation(rotation))
        ui.waitUntil(10000) { ui.activity.resources.configuration.orientation == target }
    }

    @After
    fun restoreRequestedLayout() {
        if (
            InstrumentationRegistry.getArguments().getString("vidownLandscape") == "true" ||
                InstrumentationRegistry.getArguments().getString("vidownPortrait") == "true"
        ) {
            InstrumentationRegistry.getInstrumentation()
                .uiAutomation
                .setRotation(android.app.UiAutomation.ROTATION_UNFREEZE)
        }
    }

    private val vm
        get() = ViewModelProvider(ui.activity)[MainViewModel::class.java]

    @Test
    fun settingsAndBrowserChromeRemainUsable() {
        ui.onNodeWithTag("media-input").assertIsDisplayed()
        ui.onNodeWithTag("nav-4").performClick()
        ui.onNodeWithText("深色", useUnmergedTree = true).performScrollTo().performClick()
        ui.onNodeWithText("浅色", useUnmergedTree = true).performClick()
        ui.onNodeWithText("清除浏览器数据与下载记录").performScrollTo().performClick()
        ui.onNodeWithText("清除本机数据").assertIsDisplayed()
        ui.onNodeWithText("取消").performClick()
        ui.onNodeWithTag("nav-1").performClick()
        ui.onNodeWithText("把精彩，留在身边。").assertIsDisplayed()
        ui.onNodeWithContentDescription("新标签页").performClick()
        ui.waitUntil(30000) { vm.graph.browser.tabs.value.isNotEmpty() }
        ui.waitForIdle()
        val bounds = ui.onNodeWithTag("browser-tabs").getUnclippedBoundsInRoot()
        val height = bounds.bottom - bounds.top
        ui.onNodeWithContentDescription("新标签页").performClick()
        ui.waitUntil(10000) { vm.graph.browser.tabs.value.size >= 2 }
        val updated = ui.onNodeWithTag("browser-tabs").getUnclippedBoundsInRoot()
        assertEquals(height, updated.bottom - updated.top)
        screenshot("browser-empty")
    }

    @Test
    fun rotationRecreationRetainsEditingAndNavigation() {
        ui.onNodeWithText("媒体链接，每行一个").performTextInput("https://example.org/video")
        ui.activityRule.scenario.recreate()
        ui.onNodeWithText("https://example.org/video").assertIsDisplayed()
        ui.onNodeWithTag("nav-3").performClick()
        ui.onNodeWithText("搜索记录").assertIsDisplayed()
        screenshot("history")
    }

    @Test
    fun webpageBlobSavePublishesRealMedia() = runBlocking {
        val graph = vm.graph
        val before = graph.database.tasks().all().map { it.id }.toSet()
        val tab = graph.browser.newTab("http://10.0.2.2:18763/blob-page")
        ui.runOnUiThread { vm.page.value = 1 }
        var task: String? = null
        var output: android.net.Uri? = null
        try {
            ui.waitUntil(30000) {
                graph.browser.tabs.value.find { it.id == tab }?.title == "Controlled blob ready" &&
                    graph.browser.candidates.value.any { it.tabId == tab }
            }
            ui.waitForIdle()
            val view = ui.runOnIdle { requireNotNull(findBrowser(ui.activity.window.decorView)) }
            // Compose idleness does not wait for Gecko's separate compositor. Verify the
            // fixture's actual button frame before injecting a system-coordinate touch.
            withTimeout(30000) {
                while (true) {
                    val bitmap = withContext(Dispatchers.Main) { view.capturePixels().awaitGecko() }
                    val painted = bitmap.getPixel(bitmap.width / 4, 8) == 0xff9cc9df.toInt()
                    bitmap.recycle()
                    if (painted) break
                    delay(100)
                }
            }
            screenshot("blob-before-tap")
            val point = ui.runOnIdle {
                val location = IntArray(2)
                view.getLocationOnScreen(location)
                android.graphics.PointF(
                    location[0] + view.width / 2f,
                    location[1] + 24 * view.resources.displayMetrics.density,
                )
            }
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val downTime = android.os.SystemClock.uptimeMillis()
            for (action in
                listOf(android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_UP)) {
                val event =
                    android.view.MotionEvent.obtain(
                        downTime,
                        android.os.SystemClock.uptimeMillis(),
                        action,
                        point.x,
                        point.y,
                        0,
                    )
                try {
                    instrumentation.sendPointerSync(event)
                } finally {
                    event.recycle()
                }
                if (action == android.view.MotionEvent.ACTION_DOWN) delay(80)
            }
            // Acknowledgement separates a missed/disabled DOM click from a transfer timeout.
            ui.waitUntil(10000) {
                graph.browser.tabs.value.find { it.id == tab }?.title ==
                    "Controlled blob save requested"
            }
            withTimeout(60000) {
                while (true) {
                    val found = graph.database.tasks().all().firstOrNull { it.id !in before }
                    if (found != null) {
                        task = found.id
                        if (found.state == TaskState.FAILED.name) error(found.message ?: "网页保存失败")
                        if (found.state == TaskState.COMPLETED.name) {
                            val uri = android.net.Uri.parse(found.outputUri)
                            output = uri
                            val saved =
                                graph.app.contentResolver.openInputStream(uri)!!.use {
                                    it.readBytes()
                                }
                            val expected =
                                graph.network
                                    .request(
                                        graph.browser.ref,
                                        "http://10.0.2.2:18763/sample.mp4",
                                    )
                                    .use { it.body.readBytes() }
                            assertTrue(expected.size > 1000)
                            assertArrayEquals(
                                "Saved blob must preserve the complete source file",
                                expected,
                                saved,
                            )
                            break
                        }
                    }
                    delay(100)
                }
            }
        } catch (failure: Throwable) {
            runCatching { screenshot("blob-save-failure") }
            throw failure
        } finally {
            output?.let { graph.app.contentResolver.delete(it, null, null) }
            task?.let {
                graph.queue.cancel(it)
                graph.queue.remove(it)
            }
            withContext(Dispatchers.Main) { graph.browser.close(tab) }
        }
    }

    private fun findBrowser(view: android.view.View): GeckoView? {
        if (view is GeckoView) return view
        if (view is android.view.ViewGroup) {
            for (i in 0 until view.childCount) findBrowser(view.getChildAt(i))?.let {
                return it
            }
        }
        return null
    }

    private fun screenshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val file =
            File(ui.activity.getExternalFilesDir(null), "screenshots/$name.png").apply {
                parentFile!!.mkdirs()
            }
        file.outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
}
