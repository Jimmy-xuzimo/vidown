package top.xuzimo.vidown.engine

import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import org.json.JSONObject
import top.xuzimo.vidown.browser.*
import top.xuzimo.vidown.core.*

/** Called only by the bundled Python engine on an IO thread. Never exposed to pages. */
class PythonTransport(
    private val network: SessionTransport,
    private val browser: BrowserRepository,
    private val context: RequestContextRef,
    private val owner: String,
) {
    private val streams = ConcurrentHashMap<String, SessionTransport.Response>()

    fun request(raw: String): String =
        runBlocking(Dispatchers.IO) {
            val req = JSONObject(raw)
            val h = req.optJSONObject("headers")
            val headers = h?.keys()?.asSequence()?.associateWith { h.getString(it) }.orEmpty()
            val body =
                if (req.isNull("body")) null
                else
                    req.optString("body")
                        .takeIf { it.isNotEmpty() }
                        ?.let { android.util.Base64.decode(it, android.util.Base64.DEFAULT) }
            val response =
                network.request(
                    context,
                    req.getString("url"),
                    headers,
                    req.optString("method", "GET"),
                    body,
                    owner,
                )
            val handle = newId()
            streams[handle] = response
            JSONObject()
                .put("handle", handle)
                .put("status", response.status)
                .put("url", response.url)
                .put("headers", JSONObject(response.headers))
                .toString()
        }

    fun read(handle: String, size: Int): ByteArray {
        require(size in 1..262144)
        val stream = requireNotNull(streams[handle])
        val out = ByteArray(size)
        val n = stream.body.read(out)
        return if (n < 0) ByteArray(0) else out.copyOf(n)
    }

    fun close(handle: String) {
        streams.remove(handle)?.close()
    }

    fun cookies(): String =
        runBlocking(Dispatchers.IO) {
            browser.ensureCurrent(context)
            browser.cookies()
        }

    fun closeAll() {
        streams.keys.toList().forEach(::close)
        network.abort(owner)
    }
}
