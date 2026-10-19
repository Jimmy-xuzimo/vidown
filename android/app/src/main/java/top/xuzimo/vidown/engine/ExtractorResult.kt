package top.xuzimo.vidown.engine

import org.json.JSONObject
import top.xuzimo.vidown.core.*

/** Convert the extractor boundary once; private URLs never enter UI models. */
internal fun decodeExtractedResult(
    result: String,
    url: String,
    ref: RequestContextRef,
): List<PrivateAsset> {
    val json = JSONObject(result)
    val entries = json.optJSONArray("entries")
    val items =
        if (entries == null) listOf(json)
        else (0 until entries.length()).map { entries.getJSONObject(it) }
    return items.map { json ->
        val list = json.getJSONArray("tracks")
        val tracks =
            (0 until list.length()).map { index ->
                val f = list.getJSONObject(index)
                fun num(key: String) = if (f.isNull(key)) null else f.optInt(key).takeIf { it > 0 }
                fun text(key: String) =
                    if (f.isNull(key)) null else f.optString(key).takeIf { it.isNotBlank() }
                val track =
                    Track(
                        f.getString("id"),
                        TrackKind.valueOf(f.getString("kind")),
                        f.optString("label"),
                        Protocol.valueOf(f.getString("protocol")),
                        num("width"),
                        num("height"),
                        if (f.isNull("fps")) null else f.optDouble("fps"),
                        text("codec"),
                        if (f.isNull("bitrate")) null else f.optLong("bitrate"),
                        text("language"),
                        text("dynamicRange"),
                        num("sampleRate"),
                        num("bitDepth"),
                        num("channels"),
                    )
                val hs = f.optJSONObject("headers")
                PrivateTrack(
                    track,
                    normalizeUrl(f.getString("url")),
                    hs?.keys()?.asSequence()?.associateWith { hs.getString(it) }.orEmpty(),
                    text("selector"),
                    f.optJSONArray("fallbacks")
                        ?.let { urls ->
                            (0 until minOf(urls.length(), 8))
                                .mapNotNull {
                                    runCatching {
                                        normalizeUrl(urls.getString(it))
                                    }
                                        .getOrNull()
                                }
                                .filter { it.startsWith("https://") }
                        }
                        .orEmpty(),
                )
            }
        val asset =
            MediaAsset(
                title = json.getString("title"),
                pageUrl = json.optString("pageUrl").takeIf { it.startsWith("https://") } ?: url,
                tracks = tracks.map { it.track },
                duration = if (json.isNull("duration")) null else json.optDouble("duration"),
                warnings =
                    json
                        .optJSONArray("warnings")
                        ?.let { values ->
                            (0 until minOf(values.length(), 20)).map {
                                values.getString(it).take(1000)
                            }
                        }
                        .orEmpty(),
                episodes =
                    json
                        .optJSONArray("episodes")
                        ?.let { values ->
                            (0 until minOf(values.length(), 1000)).map { index ->
                                val entry = values.getJSONObject(index)
                                EpisodeOption(
                                    entry.getString("title").take(500),
                                    normalizeUrl(entry.getString("url")),
                                )
                            }
                        }
                        .orEmpty(),
            )
        PrivateAsset(asset, tracks, ref)
    }
}
