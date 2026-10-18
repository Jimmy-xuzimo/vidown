package top.xuzimo.vidown.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import java.io.File
import kotlinx.coroutines.*
import top.xuzimo.vidown.core.safeFilename

class OutputStore(private val context: Context) {
    suspend fun publish(
        source: File,
        title: String,
        mime: String,
        extension: String,
        directory: String?,
    ): Uri =
        withContext(Dispatchers.IO) {
            val resolver = context.contentResolver
            val values =
                ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, "${safeFilename(title)}.$extension")
                    put(MediaStore.MediaColumns.MIME_TYPE, mime)
                }
            val target: Uri
            if (directory == null) {
                values.put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    if (mime.startsWith("audio/")) "Music/Vidown" else "Movies/Vidown",
                )
                values.put(MediaStore.MediaColumns.IS_PENDING, 1)
                target =
                    requireNotNull(
                        resolver.insert(
                            if (mime.startsWith("audio/"))
                                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                            else MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                            values,
                        )
                    ) {
                        "无法创建媒体文件"
                    }
            } else {
                val tree = Uri.parse(directory)
                val parent =
                    DocumentsContract.buildDocumentUriUsingTree(
                        tree,
                        DocumentsContract.getTreeDocumentId(tree),
                    )
                target =
                    requireNotNull(
                        DocumentsContract.createDocument(
                            resolver,
                            parent,
                            mime,
                            "${safeFilename(title)}.$extension",
                        )
                    ) {
                        "目录未授权或不支持创建文件"
                    }
            }
            try {
                var written = 0L
                requireNotNull(resolver.openOutputStream(target, "w")).use { out ->
                    source.inputStream().use { input ->
                        val buffer = ByteArray(256 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buffer)
                            if (n < 0) break
                            out.write(buffer, 0, n)
                            written += n
                        }
                    }
                }
                check(written == source.length()) { "保存文件不完整" }
                currentCoroutineContext().ensureActive()
                if (directory == null)
                    check(
                        resolver.update(
                            target,
                            ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                            null,
                            null,
                        ) > 0
                    ) {
                        "无法提交成品文件"
                    }
                target
            } catch (t: Throwable) {
                runCatching {
                    if (directory == null) resolver.delete(target, null, null)
                    else DocumentsContract.deleteDocument(resolver, target)
                }
                throw t
            }
        }

    fun deleteDocument(uri: String): Boolean =
        DocumentsContract.deleteDocument(context.contentResolver, Uri.parse(uri))
}
