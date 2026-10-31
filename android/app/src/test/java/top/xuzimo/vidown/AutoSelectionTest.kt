package top.xuzimo.vidown

import org.junit.Assert.*
import org.junit.Test
import top.xuzimo.vidown.core.*

class AutoSelectionTest {
    private fun track(
        id: String,
        kind: TrackKind,
        height: Int = 0,
        bitrate: Long = 0,
        selector: String? = null,
        language: String? = null,
    ) =
        PrivateTrack(
            Track(
                id,
                kind,
                id,
                Protocol.HLS,
                height = height,
                bitrate = bitrate,
                language = language,
            ),
            "https://example.org/$id",
            selector = selector,
        )

    private fun asset(
        tracks: List<PrivateTrack>,
        warnings: List<String> = emptyList(),
        episodes: List<EpisodeOption> = emptyList(),
    ) =
        PrivateAsset(
            MediaAsset(
                title = "source",
                pageUrl = "https://example.org/video",
                tracks = tracks.map { it.track },
                warnings = warnings,
                episodes = episodes,
            ),
            tracks,
            RequestContextRef("ctx", 1),
        )

    @Test
    fun selectsHighestVideoWithMatchingAudioGroup() {
        val source =
            asset(
                listOf(
                    track("low", TrackKind.VIDEO, 720),
                    track("high", TrackKind.VIDEO, 2160, selector = "audio-group:b"),
                    track("wrong", TrackKind.AUDIO, bitrate = 900, selector = "audio-group:a"),
                    track("right", TrackKind.AUDIO, bitrate = 100, selector = "audio-group:b"),
                )
            )
        assertEquals(setOf("high", "right"), automaticTracks(source))
    }

    @Test
    fun keepsWarningsEpisodesAndLanguagesAsExplicitChoices() {
        assertNull(
            automaticTracks(asset(listOf(track("v", TrackKind.MUXED)), warnings = listOf("试看")))
        )
        assertNull(
            automaticTracks(
                asset(
                    emptyList(),
                    episodes = listOf(EpisodeOption("episode", "https://example.org/ep1")),
                )
            )
        )
        assertNull(
            automaticTracks(
                asset(
                    listOf(
                        track("v", TrackKind.VIDEO),
                        track("a", TrackKind.AUDIO, language = "zh"),
                        track("b", TrackKind.AUDIO, language = "en"),
                    )
                )
            )
        )
    }

    @Test
    fun muxedSourceNeverAddsAnotherAudioTrack() {
        assertEquals(
            setOf("v"),
            automaticTracks(
                asset(listOf(track("v", TrackKind.MUXED), track("a", TrackKind.AUDIO)))
            ),
        )
    }

    @Test
    fun incompatibleAudioGroupRequiresSelection() {
        assertNull(
            automaticTracks(
                asset(
                    listOf(
                        track("v", TrackKind.VIDEO, selector = "audio-group:a"),
                        track("b", TrackKind.AUDIO, selector = "audio-group:b"),
                    )
                )
            )
        )
    }
}
