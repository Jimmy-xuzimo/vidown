package top.xuzimo.vidown.engine

import android.content.*
import android.os.*
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import org.json.JSONObject
import top.xuzimo.vidown.download.MediaDownloadEngine

class MediaProcessor(private val context: Context) {
    suspend fun process(
        id: String,
        inputs: List<String>,
        kinds: List<String>,
        output: String,
        cache: MediaDownloadEngine.CachedInput? = null,
    ): JSONObject = suspendCancellableCoroutine { continuation ->
        val bound = AtomicBoolean(false)
        var remote: IMediaWorker? = null
        val access = cache?.let { local ->
            object : ICacheBridge.Stub() {
                private fun checkCaller() {
                    check(Binder.getCallingUid() == Process.myUid())
                }

                override fun open(url: String, position: Long, key: String?, iv: String?): Long {
                    checkCaller()
                    return local.open(url, position, key, iv)
                }

                override fun read(handle: Long, size: Int): ByteArray {
                    checkCaller()
                    return local.read(handle, size)
                }

                override fun size(handle: Long): Long {
                    checkCaller()
                    return local.size(handle)
                }

                override fun close(handle: Long) {
                    checkCaller()
                    local.close(handle)
                }
            }
        }
        lateinit var connection: ServiceConnection
        fun finish() {
            cache?.closeAll()
            if (bound.compareAndSet(true, false)) runCatching { context.unbindService(connection) }
        }
        connection =
            object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                    if (!continuation.isActive) {
                        finish()
                        return
                    }
                    val worker = IMediaWorker.Stub.asInterface(binder)
                    remote = worker
                    runCatching {
                        worker.process(
                            id,
                            inputs.toTypedArray(),
                            kinds.toTypedArray(),
                            output,
                            access,
                            object : IMediaCallback.Stub() {
                                override fun complete(result: String) {
                                    finish()
                                    if (continuation.isActive)
                                        continuation.resume(JSONObject(result)) { _, _, _ -> }
                                }

                                override fun failed(message: String) {
                                    finish()
                                    if (continuation.isActive)
                                        continuation.resumeWith(
                                            Result.failure(IllegalStateException(message))
                                        )
                                }
                            },
                        )
                    }
                        .onFailure {
                            finish()
                            if (continuation.isActive) continuation.resumeWith(Result.failure(it))
                        }
                }

                override fun onServiceDisconnected(name: ComponentName) {
                    finish()
                    if (continuation.isActive)
                        continuation.resumeWith(
                            Result.failure(IllegalStateException("媒体进程已停止，请重新执行任务"))
                        )
                }

                override fun onBindingDied(name: ComponentName) = onServiceDisconnected(name)

                override fun onNullBinding(name: ComponentName) = onServiceDisconnected(name)
            }
        bound.set(true)
        if (
            !context.bindService(
                Intent(context, MediaWorkerService::class.java),
                connection,
                Context.BIND_AUTO_CREATE or Context.BIND_IMPORTANT,
            )
        ) {
            bound.set(false)
            continuation.resumeWith(Result.failure(IllegalStateException("无法启动媒体工作进程")))
        }
        continuation.invokeOnCancellation {
            runCatching { remote?.cancel(id) }
            finish()
        }
    }
}
