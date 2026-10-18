package top.xuzimo.vidown

import androidx.test.core.app.ActivityScenario
import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Run in a fresh instrumentation process, before the media/browser acceptance suite. */
class StartupIntegrationTest {
    @Test
    fun workbenchDoesNotLoadHeavyEngines() {
        ActivityScenario.launch(MainActivity::class.java).use {
            val maps = File("/proc/self/maps").readText()
            for (library in
                listOf("libxul.so", "libpython3.12.so", "libvidown_media.so", "libavformat.so")) {
                assertFalse("工作台首屏提前加载了 $library", maps.contains(library))
            }
        }
    }
}
