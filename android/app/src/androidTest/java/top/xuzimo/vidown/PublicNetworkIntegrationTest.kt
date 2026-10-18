package top.xuzimo.vidown

import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in public HTTPS check; the controlled suite must not depend on the Internet. */
class PublicNetworkIntegrationTest {
    @Test
    fun publicHttpsDoesNotRequireLocalNetworkPermission(): Unit = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("publicNetwork") == "true")
        assumeTrue(android.os.Build.VERSION.SDK_INT >= 37)
        val app = ApplicationProvider.getApplicationContext<VidownApplication>()
        assertEquals(
            PackageManager.PERMISSION_DENIED,
            app.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK"),
        )
        app.graph.browser.ensureNetworkAccess("https://example.org/")
        assertTrue(
            runCatching { app.graph.browser.ensureNetworkAccess("http://10.0.2.2:18763/") }
                .isFailure
        )
        withTimeout(45000) {
            app.graph.network.request(app.graph.browser.ref, "https://example.org/").use {
                assertEquals(200, it.status)
                assertTrue(
                    it.body.readNBytes(65536).toString(Charsets.UTF_8).contains("Example Domain")
                )
            }
        }
        assertEquals(
            PackageManager.PERMISSION_DENIED,
            app.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK"),
        )
    }
}
