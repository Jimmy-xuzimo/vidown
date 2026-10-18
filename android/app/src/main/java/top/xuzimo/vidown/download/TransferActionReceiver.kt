package top.xuzimo.vidown.download

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.launch
import top.xuzimo.vidown.VidownApplication

/** Only immutable PendingIntents created by this app can invoke this non-exported receiver. */
class TransferActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val task = intent.getStringExtra("task") ?: return
        val pending = goAsync()
        val graph = (context.applicationContext as VidownApplication).graph
        graph.scope.launch {
            try {
                when (intent.action) {
                    "pause" -> graph.queue.pause(task)
                    "cancel" -> graph.queue.cancel(task)
                }
            } catch (_: Exception) {} finally {
                pending.finish()
            }
        }
    }
}
