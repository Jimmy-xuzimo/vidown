package top.xuzimo.vidown.engine

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.hls.playlist.*
import java.io.ByteArrayInputStream
import top.xuzimo.vidown.browser.SessionTransport
import top.xuzimo.vidown.core.*

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class ProtocolInspector(private val transport: SessionTransport) {
    suspend fun inspect(
        url: String,
        protocol: Protocol,
        headers: Map<String, String>,
        context: RequestContextRef,
    ): PrivateAsset {
        val title =
            Uri.parse(url).lastPathSegment?.substringBefore('?')?.take(150)?.ifBlank { null }
                ?: "媒体资源"
        val tracks =
            when (protocol) {
                Protocol.HTTP ->
                    listOf(
                        PrivateTrack(
                            Track(
                                "original",
                                if (
                                    Regex("(?i)\\.(mp3|flac|aac|m4a|ogg|wav)(?:[?#]|$)")
                                        .containsMatchIn(url)
                                )
                                    TrackKind.AUDIO
                                else TrackKind.MUXED,
                                "源文件 · 参数将在验证时读取",
                                Protocol.HTTP,
                            ),
                            url,
                            headers,
                        )
                    )
                Protocol.HLS -> {
                    val bytes = readManifest(url, headers, context)
                    when (
                        val manifest =
                            HlsPlaylistParser().parse(Uri.parse(url), ByteArrayInputStream(bytes))
                    ) {
                        is HlsMultivariantPlaylist -> {
                            require(manifest.sessionKeyDrmInitData.isEmpty()) {
                                "媒体使用受保护的加密方式，无法作为普通点播下载"
                            }
                            manifest.variants.mapIndexed { i, v ->
                                PrivateTrack(
                                    track(
                                        "v$i",
                                        if (
                                            manifest.audios.none {
                                                it.groupId == v.audioGroupId && it.url != null
                                            } && v.format.codecs?.contains("mp4a") == true
                                        )
                                            TrackKind.MUXED
                                        else TrackKind.VIDEO,
                                        v.format,
                                        Protocol.HLS,
                                    ),
                                    v.url.toString(),
                                    headers,
                                )
                            } +
                                manifest.audios.mapIndexedNotNull { i, a ->
                                    a.url?.let {
                                        PrivateTrack(
                                            track("a$i", TrackKind.AUDIO, a.format, Protocol.HLS),
                                            it.toString(),
                                            headers,
                                        )
                                    }
                                }
                        }
                        is HlsMediaPlaylist -> {
                            require(manifest.hasEndTag) { "首版只支持点播媒体，不进行直播录制" }
                            require(manifest.protectionSchemes == null) { "媒体使用受保护的加密方式" }
                            listOf(
                                PrivateTrack(
                                    Track("hls", TrackKind.MUXED, "源清晰度", Protocol.HLS),
                                    url,
                                    headers,
                                )
                            )
                        }
                        else -> error("无法识别 HLS 清单")
                    }
                }
                Protocol.DASH -> {
                    val bytes = readManifest(url, headers, context)
                    ManifestSafety.xml(bytes)
                    val manifest =
                        DashManifestParser().parse(Uri.parse(url), ByteArrayInputStream(bytes))
                    require(!manifest.dynamic) { "首版只支持点播媒体，不进行直播录制" }
                    require(manifest.periodCount == 1) { "多 Period DASH 尚未通过连续性验证，请选择单个媒体资源" }
                    val first = manifest.getPeriod(0)
                    first.adaptationSets.flatMap { a ->
                        a.representations.map { r ->
                            require(r.format.drmInitData == null) { "媒体使用受保护的加密方式" }
                            PrivateTrack(
                                track(
                                    r.format.id ?: "${a.id}",
                                    if (a.type == C.TRACK_TYPE_AUDIO) TrackKind.AUDIO
                                    else TrackKind.VIDEO,
                                    r.format,
                                    Protocol.DASH,
                                ),
                                url,
                                headers,
                                r.format.id,
                            )
                        }
                    }
                }
                else -> error("请在原网页中使用保存操作")
            }
        require(tracks.isNotEmpty()) { "没有可用轨道" }
        val asset = MediaAsset(title = title, pageUrl = url, tracks = tracks.map { it.track })
        return PrivateAsset(asset, tracks, context)
    }

    private suspend fun readManifest(
        url: String,
        headers: Map<String, String>,
        ref: RequestContextRef,
    ): ByteArray =
        transport.request(ref, url, headers).use { r ->
            require(r.status in 200..299) { "清单请求失败（HTTP ${r.status}），请检查登录或链接有效期" }
            val bytes = r.body.readNBytes(2 * 1024 * 1024 + 1)
            require(bytes.size <= 2 * 1024 * 1024) { "清单过大" }
            bytes
        }

    private fun track(id: String, kind: TrackKind, f: Format, protocol: Protocol): Track {
        fun positive(v: Int) = v.takeIf { it > 0 }
        val label =
            listOfNotNull(
                    positive(f.height)?.let { "${it}p" },
                    f.frameRate.takeIf { it > 0 }?.let { "${it.toInt()} fps" },
                    f.codecs,
                    f.language,
                    f.label,
                )
                .joinToString(" · ")
                .ifBlank { if (kind == TrackKind.AUDIO) "独立音轨" else "源轨道" }
        return Track(
            id,
            kind,
            label,
            protocol,
            positive(f.width),
            positive(f.height),
            f.frameRate.toDouble().takeIf { it > 0 },
            f.codecs,
            positive(f.bitrate)?.toLong(),
            f.language,
            when (f.colorInfo?.colorTransfer) {
                C.COLOR_TRANSFER_ST2084 -> "HDR10"
                C.COLOR_TRANSFER_HLG -> "HLG"
                else -> null
            },
            positive(f.sampleRate),
            null,
            positive(f.channelCount),
        )
    }
}
