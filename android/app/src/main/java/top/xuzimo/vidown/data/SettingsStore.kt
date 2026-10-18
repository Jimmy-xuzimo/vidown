package top.xuzimo.vidown.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import top.xuzimo.vidown.core.AppSettings

private val Context.preferences by preferencesDataStore("settings")

class SettingsStore(private val context: Context) {
    private val key = stringPreferencesKey("preferences.v1")
    private val json = Json { ignoreUnknownKeys = true }
    val flow =
        context.preferences.data.map { p ->
            p[key]?.let { runCatching { json.decodeFromString<AppSettings>(it) }.getOrNull() }
                ?: AppSettings()
        }

    suspend fun update(transform: (AppSettings) -> AppSettings) {
        context.preferences.edit { p ->
            val before =
                p[key]?.let { runCatching { json.decodeFromString<AppSettings>(it) }.getOrNull() }
                    ?: AppSettings()
            val next = transform(before)
            require(next.concurrency in 1..4 && next.speedLimitKib >= 0)
            require(
                next.theme in setOf("iris", "ocean", "jade", "rose") &&
                    next.colorMode in setOf("system", "light", "dark")
            )
            p[key] = json.encodeToString(next)
        }
    }
}
