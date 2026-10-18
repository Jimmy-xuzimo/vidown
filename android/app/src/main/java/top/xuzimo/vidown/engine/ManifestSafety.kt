package top.xuzimo.vidown.engine

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Check before either XML parser sees untrusted DASH input. No external entities or DTDs. */
object ManifestSafety {
    fun xml(bytes: ByteArray): String {
        require(bytes.size <= 2 * 1024 * 1024) { "清单过大" }
        val text =
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        require(!Regex("<!\\s*(DOCTYPE|ENTITY)", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            "不接受含外部声明或实体的媒体清单"
        }
        return text
    }
}
