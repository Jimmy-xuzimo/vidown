package top.xuzimo.vidown

import android.Manifest
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import top.xuzimo.vidown.ui.VidownApp

class MainActivity : ComponentActivity() {
    private val model: MainViewModel by viewModels()
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        receive(intent)
        setContent {
            VidownApp(model) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        lifecycleScope.launch {
            model.graph.browser.fullScreen.collect { full ->
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    if (full) hide(WindowInsetsCompat.Type.systemBars())
                    else show(WindowInsetsCompat.Type.systemBars())
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        receive(intent)
    }

    private fun receive(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
                runCatching { top.xuzimo.vidown.core.mediaLinks(text) }
                    .getOrNull()
                    ?.let {
                        model.input.value = it.joinToString("\n")
                        model.page.value = 0
                    }
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || !model.settings.value.clipboard || model.input.value.isNotBlank()) return
        val clipboard = getSystemService(ClipboardManager::class.java)
        val text =
            clipboard.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim().orEmpty()
        if (!Regex("https?://", RegexOption.IGNORE_CASE).containsMatchIn(text)) return
        runCatching { top.xuzimo.vidown.core.mediaLinks(text.take(16384)) }
            .getOrNull()
            ?.let {
                model.input.value = it.joinToString("\n")
            }
    }
}
