package top.xuzimo.vidown

import org.junit.Assert.*
import org.junit.Test
import top.xuzimo.vidown.core.*

class ContractTest {
    @Test
    fun shareTextPreservesSelectedPartAndRejectsInvalidInput() {
        assertEquals(
            listOf("https://m.bilibili.com/video/BV1NGZtBwELa/?p=2"),
            mediaLinks("【视频分享】 https://m.bilibili.com/video/BV1NGZtBwELa/?p=2）"),
        )
        assertEquals(
            listOf("https://b23.tv/example"),
            mediaLinks("分享视频：https://b23.tv/example，快来看看"),
        )
        assertEquals(
            listOf("https://example.org/watch?a=(b)"),
            mediaLinks("(https://example.org/watch?a=(b))"),
        )
        assertEquals(listOf("https://example.org/video"), mediaLinks("example.org/video"))
        assertTrue(runCatching { mediaLinks("javascript:alert(1)") }.isFailure)
        assertTrue(runCatching { mediaLinks("https://user:secret@example.org") }.isFailure)
    }

    @Test
    fun inputNeverAllowsCredentialsOrLocalSchemes() {
        assertEquals("https://example.com/video", normalizeUrl("example.com/video"))
        for (url in
            listOf(
                "javascript:alert(1)",
                "file:///etc/passwd",
                "https://user:secret@example.com",
                "https://",
                "",
            )) assertTrue(runCatching { normalizeUrl(url) }.isFailure)
    }

    @Test
    fun completedRequiresVerification() {
        assertFalse(TaskTransitions.permits(TaskState.DOWNLOADING, TaskState.COMPLETED))
        assertFalse(TaskTransitions.permits(TaskState.CANCELLED, TaskState.DOWNLOADING))
        assertTrue(TaskTransitions.permits(TaskState.VERIFYING, TaskState.COMPLETED))
    }

    @Test
    fun diagnosticsSuppressCredentials() {
        val text =
            redact(
                "https://example.com/private?token=123\nCookie: sid=secret\nAuthorization: Bearer secret"
            )
        assertFalse(text.contains("example.com"))
        assertFalse(text.contains("secret"))
        assertFalse(text.contains("123"))
    }
}
