package top.xuzimo.vidown.engine

interface CacheAccess {
    fun open(url: String, position: Long, key: String?, iv: String?): Long

    fun read(handle: Long, size: Int): ByteArray

    fun size(handle: Long): Long

    fun close(handle: Long)
}

object NativeMedia {
    init {
        System.loadLibrary("vidown_media")
    }

    @JvmStatic
    external fun process(
        id: String,
        inputs: Array<String>,
        kinds: Array<String>,
        output: String,
        cache: CacheAccess?,
    ): String

    @JvmStatic external fun cancel(id: String)

    @JvmStatic external fun evaluate(script: String): String
}
