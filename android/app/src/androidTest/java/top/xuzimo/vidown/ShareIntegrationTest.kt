package top.xuzimo.vidown

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ShareIntegrationTest {
    @get:Rule val ui = createEmptyComposeRule()

    @Test
    fun androidShareIntentPopulatesWorkbenchWithoutStartingDownload() {
        val context = ApplicationProvider.getApplicationContext<VidownApplication>()
        val intent =
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "A shared link https://example.org/video")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            ui.onNodeWithText("https://example.org/video").assertIsDisplayed()
            scenario.onActivity { activity ->
                assertFalse(ViewModelProvider(activity)[MainViewModel::class.java].busy.value)
            }
        }
    }
}
