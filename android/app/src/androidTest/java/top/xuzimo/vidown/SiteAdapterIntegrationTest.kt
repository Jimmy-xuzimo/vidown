package top.xuzimo.vidown

import androidx.test.core.app.ApplicationProvider
import com.chaquo.python.Python
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.engine.decodeExtractedResult

/** Real packaged Python parser + Gecko download + native merge; all media is synthetic. */
class SiteAdapterIntegrationTest {
    private val graph
        get() = ApplicationProvider.getApplicationContext<VidownApplication>().graph

    private val base = "http://10.0.2.2:18763"

    private suspend fun python(): Python {
        graph.probe.probe("$base/desktop-extractor-page")
        return Python.getInstance()
    }

    @Test
    fun filmVersionsPreviewEntitlementAndDrmAreDistinct(): Unit = runBlocking {
        val p = python()
        val scope = p.getModule("builtins").callAttr("dict")
        p.getModule("builtins")
            .callAttr(
                "exec",
                """
                from vidown_sites import pgc_probe, pgc_target
                from vidown_engine import VidownBangumiIE, _asset, probe, _read_bounded
                import io, json
                from yt_dlp import YoutubeDL
                season = {'code':0, 'result':{'title':'电影', 'episodes':[{'id':123,'title':'版本一'}, {'id':456,'title':'版本二'}]}}
                season['result']['section'] = [{'episodes':[{'id':789,'title':'预告片'}]}]
                with YoutubeDL({'quiet':True}) as ydl:
                    extract = VidownBangumiIE(ydl).extract_formats
                    choice = _asset(pgc_probe('https://m.bilibili.com/bangumi/play/ss123', lambda u:season, extract))
                    assert len(choice['episodes']) == 2 and choice['tracks'] == []
                    preview = {'code':0,'result':{'play_check':{'play_detail':'PLAY_PREVIEW'},'video_info':{
                        'is_preview':1,'timelength':8000,'durl':[{'url':'https://cdn.example/preview.mp4','length':8000}]}}}
                    value = _asset(pgc_probe('https://www.bilibili.com/bangumi/play/ep123', lambda u:season if 'season?' in u else preview, extract))
                    assert value['tracks'][0]['kind'] == 'MUXED' and value['warnings'] and value['duration'] == 8
                    for denied in ({'code':-10403}, {'code':0,'result':{'video_info':{'is_drm':True}}}):
                        try:
                            pgc_probe('https://www.bilibili.com/bangumi/play/ep123', lambda u:season if 'season?' in u else denied, extract)
                        except ValueError:
                            pass
                        else:
                            raise AssertionError('Protected content became downloadable')
                # Exercise the production entry, request construction and Gecko handler too.
                class WebBridge:
                    def __init__(self): self.streams = {}
                    def cookies(self): return '[]'
                    def request(self, raw):
                        request = json.loads(raw)
                        assert request['url'].startswith('https://api.bilibili.com/pgc/')
                        data = season if '/season?' in request['url'] else preview
                        handle = str(len(self.streams))
                        self.streams[handle] = io.BytesIO(json.dumps(data).encode())
                        return json.dumps({'handle':handle,'url':request['url'],'status':200,'headers':{'Content-Type':'application/json'}})
                    def read(self, handle, size): return self.streams[handle].read(min(size, 17))
                    def close(self, handle): self.streams[handle].close()
                real = json.loads(probe('https://www.bilibili.com/bangumi/play/ep123', WebBridge()))
                assert real['tracks'][0]['kind'] == 'MUXED' and real['warnings']
                assert real['tracks'][0]['headers']['Referer'].endswith('/ep123')
                assert any(k.lower() == 'user-agent' for k in real['tracks'][0]['headers'])
                assert _read_bounded(io.BytesIO(b'abcd'), 4) == b'abcd'
                try:
                    _read_bounded(io.BytesIO(b'abcde'), 4)
                except ValueError:
                    pass
                else:
                    raise AssertionError('Oversized response was accepted')
                """
                    .trimIndent(),
                scope,
            )
    }

    @Test
    fun exactDouyinVideoDownloadsAndMergesWithoutChangingBytes(): Unit = runBlocking {
        val p = python()
        val scope = p.getModule("builtins").callAttr("dict")
        p.getModule("builtins")
            .callAttr(
                "exec",
                """
            import json
            from vidown_sites import douyin_data, douyin_id
            from vidown_engine import _asset
            identity = '7666811827413601586'
            assert douyin_id('https://www.douyin.com/jingxuan?modal_id='+identity) == identity
            source = {'aweme_id':identity,'desc':'受控视频','video':{'duration':8000,'play_addr':{'url_list':['$base/sample.mp4'],'width':320,'height':180}}}
            assert douyin_data({'aweme_id':'7666811827413601587','video':source['video']}, identity) is None
            assert douyin_data({'aweme_id':int(identity),'video':source['video']}, identity) is None
            result = json.dumps(_asset(douyin_data({'recommendation':{},'aweme_detail':source}, identity)))
        """
                    .trimIndent(),
                scope,
            )
        val private =
            decodeExtractedResult(
                    scope.callAttr("__getitem__", "result").toString(),
                    "https://www.douyin.com/video/7666811827413601586",
                    graph.browser.ref,
                )
                .single()
        assertEquals(TrackKind.MUXED, private.tracks.single().track.kind)
        assertTrue(private.asset.warnings.isNotEmpty())
        val plan = DownloadPlan(asset = private, tracks = private.tracks)
        val dir = File(graph.app.noBackupFilesDir, "tasks/${plan.id}").apply { mkdirs() }
        try {
            val download = graph.downloads.download(plan) { _, _, _ -> }
            val input = graph.downloads.input(plan.id)
            try {
                val handle = input.open(download.inputs.single(), 0, null, null)
                val actual = java.io.ByteArrayOutputStream()
                while (true) {
                    val bytes = input.read(handle, 65536)
                    if (bytes.isEmpty()) break
                    actual.write(bytes)
                }
                val expected =
                    graph.network.request(graph.browser.ref, "$base/sample.mp4").use {
                        it.body.readBytes()
                    }
                assertArrayEquals(expected, actual.toByteArray())
            } finally {
                input.closeAll()
            }
            val report =
                graph.processor.process(
                    plan.id,
                    download.inputs,
                    listOf("MUXED"),
                    File(dir, "verified.mp4").path,
                    graph.downloads.input(plan.id),
                )
            assertEquals(8.0, report.getDouble("duration"), .3)
            assertEquals(2, report.getJSONArray("streams").length())
        } finally {
            graph.downloads.release(plan.id)
            dir.deleteRecursively()
        }
    }
}
