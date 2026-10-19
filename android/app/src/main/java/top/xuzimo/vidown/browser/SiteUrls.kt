package top.xuzimo.vidown.browser

import java.net.URI
import java.net.URLDecoder

internal fun isDouyinPage(value: String): Boolean = runCatching {
    val u = URI(value)
    u.scheme in setOf("https", "http") &&
        u.rawUserInfo == null &&
        u.host in
            setOf(
                "douyin.com",
                "www.douyin.com",
                "v.douyin.com",
                "iesdouyin.com",
                "www.iesdouyin.com",
            )
}
    .getOrDefault(false)

internal fun douyinVideoId(value: String): String? {
    if (!isDouyinPage(value)) return null
    val u = URI(value)
    val path = Regex("^/(?:share/)?video/(\\d+)(?:/|$)").find(u.path)?.groupValues?.get(1)
    val query =
        u.rawQuery
            .orEmpty()
            .split('&')
            .map { it.split('=', limit = 2) }
            .firstOrNull { it[0] in setOf("modal_id", "vid") }
            ?.getOrNull(1)
            ?.let { URLDecoder.decode(it, "UTF-8") }
    return (path ?: query)?.takeIf { it.matches(Regex("\\d{8,24}")) }
}
