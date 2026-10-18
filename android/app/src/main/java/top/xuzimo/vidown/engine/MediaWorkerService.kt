package top.xuzimo.vidown.engine

import android.app.Service
import android.content.Intent
import android.os.*
import java.io.File
import java.util.concurrent.Executors
import top.xuzimo.vidown.core.redact

/** Private same-UID process. Remote web content never receives this Binder. */
class MediaWorkerService : Service() {
    private val executor = Executors.newFixedThreadPool(2)

    private fun ownCaller() {
        check(Binder.getCallingUid() == Process.myUid())
    }

    private fun checkedPath(path: String): String {
        val file = File(path).canonicalFile
        val root = File(noBackupFilesDir, "tasks").canonicalFile
        require(file.toPath().startsWith(root.toPath())) { "媒体工作目录不合法" }
        return file.path
    }

    private val binder =
        object : IMediaWorker.Stub() {
            override fun process(
                id: String,
                inputs: Array<String>,
                kinds: Array<String>,
                output: String,
                cache: ICacheBridge?,
                callback: IMediaCallback,
            ) {
                ownCaller()
                require(id.matches(Regex("[a-f0-9-]{36}")))
                require(inputs.size in 1..4 && inputs.size == kinds.size)
                if (output.isNotEmpty()) checkedPath(output)
                inputs
                    .filterNot { it.startsWith("http://") || it.startsWith("https://") }
                    .forEach(::checkedPath)
                executor.execute {
                    try {
                        val reader = cache?.let { remote ->
                            object : CacheAccess {
                                override fun open(
                                    url: String,
                                    position: Long,
                                    key: String?,
                                    iv: String?,
                                ) = remote.open(url, position, key, iv)

                                override fun read(handle: Long, size: Int) =
                                    remote.read(handle, size)

                                override fun size(handle: Long) = remote.size(handle)

                                override fun close(handle: Long) = remote.close(handle)
                            }
                        }
                        callback.complete(NativeMedia.process(id, inputs, kinds, output, reader))
                    } catch (t: Throwable) {
                        runCatching { callback.failed(redact(t.message ?: "媒体处理失败")) }
                    }
                }
            }

            override fun cancel(id: String) {
                ownCaller()
                NativeMedia.cancel(id)
            }
        }

    override fun onBind(intent: Intent) = binder

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }
}
