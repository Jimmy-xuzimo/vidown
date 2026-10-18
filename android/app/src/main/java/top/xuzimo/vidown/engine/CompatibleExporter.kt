package top.xuzimo.vidown.engine

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.transformer.*
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*
import org.json.JSONObject

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class CompatibleExporter(private val context: Context) {
    suspend fun export(source: File, target: File, report: JSONObject) =
        withContext(Dispatchers.Main.immediate) {
            val tracks = report.getJSONArray("streams")
            for (i in 0 until tracks.length()) {
                val t = tracks.getJSONObject(i)
                require(
                    !t.optBoolean("dolbyVision") && t.optInt("colorTransfer") !in setOf(16, 18)
                ) {
                    "HDR／杜比视界暂不执行兼容转换，请保留源画质"
                }
            }
            suspendCancellableCoroutine<Unit> { continuation ->
                val transformer =
                    Transformer.Builder(context)
                        .setVideoMimeType(MimeTypes.VIDEO_H264)
                        .setAudioMimeType(MimeTypes.AUDIO_AAC)
                        .addListener(
                            object : Transformer.Listener {
                                override fun onCompleted(
                                    composition: Composition,
                                    exportResult: ExportResult,
                                ) {
                                    if (continuation.isActive) continuation.resume(Unit)
                                }

                                override fun onError(
                                    composition: Composition,
                                    exportResult: ExportResult,
                                    exportException: ExportException,
                                ) {
                                    if (continuation.isActive)
                                        continuation.resumeWithException(
                                            IllegalStateException(
                                                "系统编码器无法完成兼容导出（${exportException.errorCode}）"
                                            )
                                        )
                                }
                            }
                        )
                        .build()
                continuation.invokeOnCancellation {
                    Handler(Looper.getMainLooper()).post {
                        transformer.cancel()
                        target.delete()
                    }
                }
                try {
                    transformer.start(
                        EditedMediaItem.Builder(MediaItem.fromUri(android.net.Uri.fromFile(source)))
                            .build(),
                        target.path,
                    )
                } catch (t: Throwable) {
                    if (continuation.isActive) continuation.resumeWithException(t)
                }
            }
        }
}
