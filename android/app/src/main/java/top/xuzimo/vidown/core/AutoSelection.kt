package top.xuzimo.vidown.core

/** Rank source tracks; never choose an episode or language on the user's behalf. */
fun automaticTracks(asset: PrivateAsset): Set<String>? {
    if (
        asset.asset.episodes.isNotEmpty() ||
            asset.asset.warnings.isNotEmpty() ||
            asset.tracks.any { it.track.protocol == Protocol.BROWSER }
    )
        return null
    val video =
        asset.tracks
            .filter { it.track.kind != TrackKind.AUDIO }
            .sortedWith(
                compareByDescending<PrivateTrack> { it.track.height ?: 0 }
                    .thenByDescending { it.track.fps ?: 0.0 }
                    .thenByDescending { it.track.bitrate ?: 0L }
            )
            .firstOrNull()
    val audios =
        asset.tracks
            .filter { it.track.kind == TrackKind.AUDIO }
            .sortedWith(
                compareByDescending<PrivateTrack> {
                        it.track.codec.orEmpty().contains("flac", true)
                    }
                    .thenByDescending { it.track.bitrate ?: 0L }
            )
    if (audios.mapNotNull { it.track.language }.distinct().size > 1) return null
    if (video?.track?.kind == TrackKind.MUXED) return setOf(video.track.id)
    val audio = audios.firstOrNull {
        video?.selector?.startsWith("audio-group:") != true || it.selector == video.selector
    }
    if (video != null && audios.isNotEmpty() && audio == null) return null
    return listOfNotNull(video?.track?.id, audio?.track?.id).toSet().takeIf { it.isNotEmpty() }
}

enum class SubmissionState {
    WAITING,
    PROBING,
    ENQUEUING,
    SELECTION,
    QUEUED,
    FAILED,
    CANCELLED,
}

data class LinkSubmission(
    val id: String = newId(),
    val url: String,
    val state: SubmissionState = SubmissionState.WAITING,
    val title: String = java.net.URI(url).host.orEmpty(),
    val asset: MediaAsset? = null,
    val taskId: String? = null,
    val error: String? = null,
)
