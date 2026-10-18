package top.xuzimo.vidown

import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.chaquo.python.Python
import java.io.File
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.engine.decodeExtractedResult
import top.xuzimo.vidown.ui.AssetCard
import top.xuzimo.vidown.ui.VidownTheme

class FormatSelectionIntegrationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val vm
        get() = ViewModelProvider(ui.activity)[MainViewModel::class.java]

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
        )
            InstrumentationRegistry.getInstrumentation()
                .uiAutomation
                .setRotation(android.app.UiAutomation.ROTATION_UNFREEZE)
    }

    private val base = "http://10.0.2.2:18763"

    @Test
    fun extractionFailureStaysVisibleAndRetryClearsIt() {
        ui.runOnUiThread {
            vm.input.value = "$base/expired"
            vm.probe()
        }
        ui.waitUntil(45000) { !vm.busy.value && vm.probeError.value != null }
        ui.onNodeWithTag("probe-error").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("暂时无法解析").assertIsDisplayed()
        ui.runOnUiThread {
            vm.input.value = "分享视频：$base/page）"
            vm.probe()
        }
        ui.waitUntil(45000) {
            !vm.busy.value && vm.assets.value.any { it.pageUrl == "$base/page" }
        }
        assertNull(vm.probeError.value)
        ui.onNodeWithTag("probe-error").assertDoesNotExist()
    }

    @Test
    fun packagedBilibiliParserPreservesQualityAndIndependentAudioSelection() = runBlocking {
        vm.graph.probe.probe("$base/page")
        val python = Python.getInstance()
        val scope = python.getModule("builtins").callAttr("dict")
        // Synthetic API metadata goes through the packaged upstream Bilibili parser, the
        // production Python conversion and Kotlin boundary. No live account is involved.
        python
            .getModule("builtins")
            .callAttr(
                "exec",
                """
                import json
                from yt_dlp import YoutubeDL
                from yt_dlp.extractor.bilibili import BilibiliBaseIE
                from vidown_engine import _asset, VidownBilibiliIE
                play = {'support_formats': [
                    {'quality': 126, 'new_description': 'Dolby Vision'},
                    {'quality': 125, 'new_description': 'HDR10'},
                    {'quality': 80, 'new_description': '1080p AVC'}],
                    'dash': {'video': [
                        {'id':126, 'baseUrl':'https://media.example/video-dv.m4s', 'width':3840, 'height':2160, 'frameRate':'60', 'codecs':'dvh1.08.06', 'bandwidth':18000000},
                        {'id':125, 'baseUrl':'https://media.example/video-hdr.m4s', 'width':3840, 'height':2160, 'frameRate':'60', 'codecs':'hev1.2.4.L153.B0', 'bandwidth':16000000},
                        {'id':80, 'baseUrl':'https://media.example/video-avc.m4s', 'backupUrl':['https://backup.example/video-avc.m4s'], 'width':1920, 'height':1080, 'frameRate':'30', 'codecs':'avc1.640028', 'bandwidth':4000000}],
                        'audio':[{'id':30280,'baseUrl':'https://media.example/audio-aac.m4s','codecs':'mp4a.40.2','bandwidth':192000}],
                        'flac':{'audio':{'id':30251,'baseUrl':'https://media.example/audio-flac.m4s','codecs':'fLaC','bandwidth':1200000}},
                        'dolby':{'audio':[{'id':30250,'baseUrl':'https://media.example/audio-dolby.m4s','codecs':'ec-3','bandwidth':448000}]}}}
                with YoutubeDL({'quiet':True, 'no_warnings':True}) as ydl:
                    formats = VidownBilibiliIE(ydl).extract_formats(play)
                encoded = json.dumps(_asset({'title':'Controlled quality selection', 'formats':formats}))
                """
                    .trimIndent(),
                scope,
            )
        val asset =
            decodeExtractedResult(
                    scope.callAttr("__getitem__", "encoded").toString(),
                    "https://www.bilibili.com/video/controlled",
                    vm.graph.browser.ref,
                )
                .single()
        val videos = asset.asset.tracks.filter { it.kind == TrackKind.VIDEO }
        val audios = asset.asset.tracks.filter { it.kind == TrackKind.AUDIO }
        assertEquals(3, videos.size)
        assertEquals(3, audios.size)
        assertTrue(videos.any { it.dynamicRange == "DV" && it.height == 2160 })
        assertTrue(videos.any { it.dynamicRange == "HDR10" })
        assertTrue(audios.any { it.codec == "flac" })
        assertTrue(audios.any { it.codec == "ec-3" })
        assertTrue(asset.asset.tracks.all { it.id.startsWith("track-") })
        assertEquals(
            listOf("https://backup.example/video-avc.m4s"),
            asset.tracks.single { it.track.height == 1080 }.fallbacks,
        )
        var selected: Set<String>? = null
        ui.runOnUiThread {
            ui.activity.setContent {
                VidownTheme(AppSettings()) {
                    androidx.compose.foundation.layout.Box(
                        androidx.compose.ui.Modifier.fillMaxSize().safeDrawingPadding()
                    ) {
                        androidx.compose.foundation.lazy.LazyColumn {
                            item { AssetCard(asset.asset) { ids, _, _ -> selected = ids } }
                        }
                    }
                }
            }
        }
        ui.onNodeWithTag("video-format").performScrollTo().performClick()
        ui.onNode(hasText("avc1.640028", substring = true) and hasClickAction())
            .performScrollTo()
            .assertIsDisplayed()
            .performClick()
        ui.onNodeWithTag("audio-format").performScrollTo().performClick()
        ui.onAllNodes(hasText("flac", substring = true) and hasClickAction())
            .onLast()
            .performScrollTo()
            .assertIsDisplayed()
            .performClick()
        screenshot("quality-selection")
        ui.onNodeWithText("加入队列").performScrollTo().performClick()
        assertEquals(
            setOf(videos.single { it.height == 1080 }.id, audios.single { it.codec == "flac" }.id),
            selected,
        )
        assertEquals(
            setOf("https://media.example/video-avc.m4s", "https://media.example/audio-flac.m4s"),
            asset.tracks.filter { it.track.id in selected.orEmpty() }.map { it.url }.toSet(),
        )
    }

    @Test
    fun workbenchStartsWithInputAndSuccessfulProbeRevealsBothPickers(): Unit = runBlocking {
        ui.onNodeWithTag("media-input").assertIsDisplayed()
        ui.onNodeWithText("添加媒体链接").assertIsDisplayed()
        ui.runOnUiThread {
            vm.input.value = "$base/split/master.m3u8"
            vm.probe()
        }
        ui.waitUntil(60000) { vm.assets.value.isNotEmpty() && !vm.busy.value }
        ui.onNodeWithTag("video-format").assertIsDisplayed()
        ui.onNodeWithTag("audio-format").performScrollTo().assertIsDisplayed()
        val asset = vm.assets.value.first()
        assertEquals(setOf(TrackKind.VIDEO, TrackKind.AUDIO), asset.tracks.map { it.kind }.toSet())
        screenshot("auto-revealed-formats")
        ui.onNodeWithTag("nav-2").performClick()
        ui.onNodeWithTag("nav-0").performClick()
        ui.onNodeWithTag("media-input").assertIsDisplayed()
    }

    private fun screenshot(name: String) {
        ui.waitForIdle()
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
