package top.xuzimo.vidown

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.mozilla.geckoview.GeckoSessionSettings
import top.xuzimo.vidown.core.newId

class NativeDesignIntegrationTest {
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
    fun horizontalSwipesKeepNavigationVisibleAndPreserveInput() {
        ui.onNodeWithTag("media-input").performTextReplacement("https://example.org/kept")
        ui.onNodeWithTag("main-pager").performTouchInput { swipeLeft() }
        ui.waitUntil(10000) { vm.page.value == 1 }
        ui.onNodeWithTag("floating-navigation").assertIsDisplayed()
        ui.onNodeWithTag("nav-1").assertIsSelected()
        ui.onNodeWithTag("main-pager").performTouchInput { swipeLeft() }
        ui.waitUntil(10000) { vm.page.value == 2 }
        ui.onNodeWithTag("floating-navigation").assertIsDisplayed()
        ui.onNodeWithTag("main-pager").performTouchInput { swipeRight() }
        ui.waitUntil(10000) { vm.page.value == 1 }
        ui.onNodeWithTag("main-pager").performTouchInput { swipeRight() }
        ui.waitUntil(10000) { vm.page.value == 0 }
        ui.onNodeWithTag("media-input").assertTextContains("https://example.org/kept")
        ui.onNodeWithTag("floating-navigation").assertIsDisplayed()
    }

    @Test
    fun desktopDefaultUsesRealDesktopUserAgentAndViewportAndCanSwitchBack() = runBlocking {
        val browser = vm.graph.browser
        val tab = browser.newTab("http://10.0.2.2:18763/browser-layout?case=${newId()}")
        ui.runOnUiThread { vm.page.value = 1 }
        try {
            ui.waitUntil(30000) {
                val title = browser.tabs.value.find { it.id == tab }?.title.orEmpty()
                title.startsWith("Layout ") &&
                    (title.split(' ').getOrNull(1)?.toIntOrNull() ?: 0) > 0
            }
            val desktop = browser.tabs.value.first { it.id == tab }
            assertTrue(desktop.desktop)
            assertEquals(
                GeckoSessionSettings.USER_AGENT_MODE_DESKTOP,
                browser.session(tab)!!.settings.userAgentMode,
            )
            assertEquals(
                GeckoSessionSettings.VIEWPORT_MODE_DESKTOP,
                browser.session(tab)!!.settings.viewportMode,
            )
            assertFalse(desktop.title.contains("Android"))
            assertFalse(desktop.title.contains("Mobile"))
            assertTrue(
                "Desktop viewport must ignore a mobile width=device-width declaration: ${desktop.title}",
                desktop.title.split(' ')[1].toInt() >= 980,
            )
            ui.onNodeWithTag("desktop-mode").assertIsSelected().performClick()
            ui.waitUntil(30000) {
                browser.tabs.value.first { it.id == tab }.title.contains("Android")
            }
            assertFalse(browser.tabs.value.first { it.id == tab }.desktop)
            assertEquals(
                GeckoSessionSettings.VIEWPORT_MODE_MOBILE,
                browser.session(tab)!!.settings.viewportMode,
            )
            val next = browser.newTab()
            assertTrue(browser.tabs.value.first { it.id == next }.desktop)
            assertEquals(
                GeckoSessionSettings.USER_AGENT_MODE_DESKTOP,
                browser.session(next)!!.settings.userAgentMode,
            )
            assertEquals(
                GeckoSessionSettings.VIEWPORT_MODE_DESKTOP,
                browser.session(next)!!.settings.viewportMode,
            )
            withContext(Dispatchers.Main) { browser.close(next) }
        } finally {
            withContext(Dispatchers.Main) { browser.close(tab) }
        }
    }

    @Test
    fun resourceSheetAndFixedTabsRemainAccessible() = runBlocking {
        ui.onNodeWithTag("nav-1").performClick()
        ui.onNodeWithContentDescription("新标签页").performClick()
        ui.waitUntil(30000) { vm.graph.browser.tabs.value.isNotEmpty() }
        val before = ui.onNodeWithTag("browser-tabs").getUnclippedBoundsInRoot()
        ui.onNodeWithContentDescription("新标签页").performClick()
        ui.waitUntil(10000) { vm.graph.browser.tabs.value.size >= 2 }
        val after = ui.onNodeWithTag("browser-tabs").getUnclippedBoundsInRoot()
        assertEquals(before.bottom - before.top, after.bottom - after.top)
        assertTrue(after.bottom - after.top >= 48.dp)
        ui.onNodeWithTag("desktop-mode").assertIsSelected()
        ui.onNodeWithContentDescription("探测到的资源").performClick()
        ui.onNodeWithText("媒体资源").assertIsDisplayed()
        ui.onNodeWithText("等待发现媒体").assertIsDisplayed()
        screenshot("resources-native")
    }

    @Test
    fun themesAndReducedMotionKeepNavigationUsable() = runBlocking {
        for (mode in listOf("light", "dark")) {
            for (theme in listOf("iris", "ocean", "jade", "rose")) {
                vm.graph.settingsStore.update {
                    it.copy(colorMode = mode, theme = theme, animations = false)
                }
                ui.runOnUiThread { vm.page.value = 0 }
                ui.waitForIdle()
                ui.onNodeWithTag("media-input").performScrollTo().assertIsDisplayed()
                ui.runOnUiThread {
                    val bars =
                        androidx.core.view.WindowCompat.getInsetsController(
                            ui.activity.window,
                            ui.activity.window.decorView,
                        )
                    assertEquals(mode == "light", bars.isAppearanceLightStatusBars)
                    assertEquals(mode == "light", bars.isAppearanceLightNavigationBars)
                }
                screenshot("workbench-$mode-$theme")
            }
        }
        ui.onNodeWithTag("nav-2").performClick()
        ui.onNodeWithText("准备好保存精彩").assertIsDisplayed()
        ui.onNodeWithTag("nav-3").performClick()
        ui.onNodeWithText("搜索记录").assertIsDisplayed()
        ui.onNodeWithTag("nav-4").performClick()
        ui.onNodeWithText("界面动效").performScrollTo().assertIsDisplayed()
        screenshot("settings-dark")
        vm.graph.settingsStore.update {
            it.copy(colorMode = "light", theme = "iris", animations = true)
        }
    }

    @Test
    fun navigationTouchTargetsAreAtLeast48Dp() {
        val root = ui.onRoot().getUnclippedBoundsInRoot()
        val bar = ui.onNodeWithTag("floating-navigation").getUnclippedBoundsInRoot()
        if (
            ui.activity.resources.configuration.orientation ==
                android.content.res.Configuration.ORIENTATION_LANDSCAPE
        ) {
            assertTrue("Landscape navigation must stay on the left", bar.right < root.right * .25f)
            assertTrue(
                "Side navigation must be vertically centered",
                kotlin.math.abs(((bar.top + bar.bottom) / 2 - (root.top + root.bottom) / 2).value) <
                    2f,
            )
        } else {
            assertTrue("Portrait navigation must stay at the bottom", bar.top > root.bottom * .65f)
            assertTrue(
                "Bottom navigation must be centered",
                kotlin.math.abs(((bar.left + bar.right) / 2 - (root.left + root.right) / 2).value) <
                    2f,
            )
        }
        for (i in 0..4) {
            val bounds = ui.onNodeWithTag("nav-$i").getUnclippedBoundsInRoot()
            assertTrue("Navigation $i is too narrow", bounds.right - bounds.left >= 48.dp)
            assertTrue("Navigation $i is too short", bounds.bottom - bounds.top >= 48.dp)
        }
        screenshot("workbench-initial")
    }

    private fun screenshot(name: String) {
        ui.waitForIdle()
        android.os.SystemClock.sleep(800) // Allow the system display-rotation animation to settle.
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val file =
            File(ui.activity.getExternalFilesDir(null), "screenshots/ui3-$name.png").apply {
                parentFile!!.mkdirs()
            }
        file.outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
}
