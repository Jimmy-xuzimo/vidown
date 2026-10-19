package top.xuzimo.vidown.core

import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.Serializable

@Serializable
enum class Protocol {
    HTTP,
    HLS,
    DASH,
    BROWSER,
}

@Serializable
enum class TrackKind {
    VIDEO,
    AUDIO,
    MUXED,
}

@Serializable
enum class TaskState {
    QUEUED,
    DOWNLOADING,
    PAUSED,
    MERGING,
    VERIFYING,
    COMPLETED,
    CANCELLED,
    FAILED,
    INTERRUPTED,
}

@Serializable data class RequestContextRef(val id: String, val generation: Long)

@Serializable
data class SourceCandidate(
    val id: String = newId(),
    val tabId: String,
    val pageUrl: String,
    val host: String,
    val protocol: Protocol,
    val contentType: String,
    val detectedAt: Long = System.currentTimeMillis(),
)

@Serializable
data class Track(
    val id: String,
    val kind: TrackKind,
    val label: String,
    val protocol: Protocol,
    val width: Int? = null,
    val height: Int? = null,
    val fps: Double? = null,
    val codec: String? = null,
    val bitrate: Long? = null,
    val language: String? = null,
    val dynamicRange: String? = null,
    val sampleRate: Int? = null,
    val bitDepth: Int? = null,
    val channels: Int? = null,
)

@Serializable data class EpisodeOption(val title: String, val url: String)

@Serializable
data class MediaAsset(
    val id: String = newId(),
    val title: String,
    val pageUrl: String,
    val tracks: List<Track>,
    val warnings: List<String> = emptyList(),
    val duration: Double? = null,
    val episodes: List<EpisodeOption> = emptyList(),
)

@Serializable
data class PrivateTrack(
    val track: Track,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val selector: String? = null,
    val fallbacks: List<String> = emptyList(),
)

@Serializable
data class PrivateAsset(
    val asset: MediaAsset,
    val tracks: List<PrivateTrack>,
    val context: RequestContextRef,
)

@Serializable
data class DownloadPlan(
    val id: String = newId(),
    val asset: PrivateAsset,
    val tracks: List<PrivateTrack>,
    val compatible: Boolean = false,
    val directoryUri: String? = null,
)

@Serializable
data class TaskEvent(
    val taskId: String,
    val sequence: Long,
    val state: TaskState,
    val bytes: Long,
    val total: Long? = null,
    val message: String? = null,
)

@Serializable
data class BrowserTab(
    val id: String,
    val url: String = "about:blank",
    val title: String = "新标签页",
    val loading: Boolean = false,
    val canGoBack: Boolean = false,
    val canGoForward: Boolean = false,
    val desktop: Boolean = true,
)

@Serializable
data class AppSettings(
    val colorMode: String = "system",
    val theme: String = "iris",
    val animations: Boolean = true,
    val clipboard: Boolean = false,
    val concurrency: Int = 2,
    val speedLimitKib: Int = 0,
    val proxy: String = "system",
    val unmeteredOnly: Boolean = false,
    val directoryUri: String? = null,
)

fun newId(): String = UUID.randomUUID().toString()

fun sha256(value: String): String =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") {
        "%02x".format(it)
    }

fun normalizeUrl(input: String): String {
    val raw = input.trim()
    require(raw.isNotEmpty() && raw.length <= 16384) { "请输入有效网址" }
    val value = if (Regex("^[A-Za-z][A-Za-z0-9+.-]*:").containsMatchIn(raw)) raw else "https://$raw"
    val parsed = URI(value)
    require(
        parsed.scheme.lowercase() in setOf("http", "https") &&
            !parsed.host.isNullOrBlank() &&
            parsed.rawUserInfo == null
    ) {
        "仅支持不含账号密码的 HTTP／HTTPS 地址"
    }
    return parsed.toASCIIString()
}

/** Accept ordinary URLs and the surrounding text supplied by Android share sheets. */
fun mediaLinks(input: String): List<String> {
    val found =
        Regex("https?://[^\\s<>\"\\u0000-\\u001f，。；！？）》】」』]+", RegexOption.IGNORE_CASE)
            .findAll(input)
            .map { it.value }
            .toList()
    val values = found.ifEmpty { input.lines().map(String::trim).filter(String::isNotBlank) }
    require(values.isNotEmpty()) { "请粘贴一个或多个媒体链接" }
    require(values.size <= 50) { "一次最多解析 50 个链接" }
    return values
        .map { value ->
            var clean = value.trimEnd('。', '，', '；', '！', '？', '）', '】', '》', '」', '』')
            for ((end, start) in listOf(')' to '(', ']' to '[', '}' to '{')) {
                while (
                    clean.endsWith(end) && clean.count { it == end } > clean.count { it == start }
                ) clean = clean.dropLast(1)
            }
            normalizeUrl(clean)
        }
        .distinct()
}

fun safeFilename(input: String): String =
    input.replace(Regex("""[\\/:*?"<>|\p{Cntrl}]"""), "_").trim(' ', '.').take(100).ifBlank {
        "Vidown"
    }

fun redact(input: String): String =
    input
        .replace(Regex("""https?://[^\s]+"""), "[链接已隐藏]")
        .replace(
            Regex("""(?i)(cookie|authorization|token|password|set-cookie)\s*[:=]\s*[^\r\n]+"""),
            "$1=[已隐藏]",
        )

object TaskTransitions {
    private val allowed =
        mapOf(
            TaskState.QUEUED to
                setOf(
                    TaskState.DOWNLOADING,
                    TaskState.CANCELLED,
                    TaskState.INTERRUPTED,
                    TaskState.FAILED,
                ),
            TaskState.DOWNLOADING to
                setOf(
                    TaskState.PAUSED,
                    TaskState.MERGING,
                    TaskState.VERIFYING,
                    TaskState.CANCELLED,
                    TaskState.FAILED,
                    TaskState.INTERRUPTED,
                ),
            TaskState.PAUSED to setOf(TaskState.QUEUED, TaskState.CANCELLED, TaskState.INTERRUPTED),
            TaskState.MERGING to
                setOf(
                    TaskState.VERIFYING,
                    TaskState.CANCELLED,
                    TaskState.FAILED,
                    TaskState.INTERRUPTED,
                ),
            TaskState.VERIFYING to
                setOf(
                    TaskState.COMPLETED,
                    TaskState.CANCELLED,
                    TaskState.FAILED,
                    TaskState.INTERRUPTED,
                ),
        )

    fun permits(from: TaskState, to: TaskState): Boolean =
        from == to || to in allowed[from].orEmpty()

    fun active(state: TaskState): Boolean =
        state in
            setOf(
                TaskState.QUEUED,
                TaskState.DOWNLOADING,
                TaskState.PAUSED,
                TaskState.MERGING,
                TaskState.VERIFYING,
            )
}
