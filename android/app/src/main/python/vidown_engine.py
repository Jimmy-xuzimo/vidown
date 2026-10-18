"""Fixed, packaged extractor. All network IO uses the current Gecko session."""
import base64
import http.cookiejar
import io
import json
import re
from urllib.parse import urlsplit, urlunsplit, parse_qs, urlencode
from yt_dlp import YoutubeDL
from yt_dlp.extractor.bilibili import BiliBiliIE, BiliBiliBangumiIE
from yt_dlp.cookies import YoutubeDLCookieJar
from yt_dlp.networking.common import RequestHandler, Response
from yt_dlp.networking.exceptions import HTTPError
from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
from yt_dlp.extractor.youtube.jsc.provider import register_provider, register_preference
from yt_dlp.extractor.youtube.pot._provider import BuiltinIEContentProvider


@register_provider
class VidownQuickJSJCP(EJSBaseJCP, BuiltinIEContentProvider):
    PROVIDER_NAME = 'vidown_quickjs'
    JS_RUNTIME_NAME = 'quickjs'

    def is_available(self):
        return self._available

    def _run_js_runtime(self, stdin):
        return evaluate_javascript(stdin)


def evaluate_javascript(stdin):
    from java import jclass
    native = jclass('top.xuzimo.vidown.engine.NativeMedia')
    # Capture output after all bounded promise jobs have run, using core intrinsics only.
    script = "globalThis.__vidownOutput='';globalThis.console={log:(s)=>{globalThis.__vidownOutput+=String(s)+'\\n';},warn:()=>{},error:()=>{}};\n" + stdin
    return str(native.evaluate(script))


def check_packaged_solver():
    import yt_dlp_ejs.yt.solver
    script = yt_dlp_ejs.yt.solver.lib() + '\nObject.assign(globalThis,lib);\n' + yt_dlp_ejs.yt.solver.core()
    return evaluate_javascript(script + "\nconsole.log(JSON.stringify({solver:typeof jsc,answer:6*7}));")


@register_preference(VidownQuickJSJCP)
def _embedded_preference(provider, requests):
    return 1000


class NativeBody(io.RawIOBase):
    def __init__(self, bridge, handle):
        self.bridge, self.handle = bridge, handle
        super().__init__()

    def readable(self):
        return True

    def read(self, size=-1):
        if self.closed:
            return b''
        if size is None:
            size = -1
        if size < 0:
            output = bytearray()
            while block := bytes(self.bridge.read(self.handle, 65536)):
                output.extend(block)
                if len(output) > 32 * 1024 * 1024:
                    raise ValueError('提取响应过大')
            return bytes(output)
        return bytes(self.bridge.read(self.handle, min(size, 262144))) if size else b''

    def readinto(self, buf):
        data = self.read(len(buf))
        buf[:len(data)] = data
        return len(data)

    def close(self):
        if not self.closed:
            self.bridge.close(self.handle)
        super().close()


class GeckoRH(RequestHandler):
    _SUPPORTED_URL_SCHEMES = ('http', 'https')
    _SUPPORTED_PROXY_SCHEMES = ()
    _SUPPORTED_FEATURES = ()

    def __init__(self, bridge, **kwargs):
        self.bridge = bridge
        super().__init__(**kwargs)

    def _send(self, request):
        raw = self.bridge.request(json.dumps({
            'url': request.url, 'method': request.method,
            'headers': self._get_headers(request),
            'body': base64.b64encode(request.data).decode() if request.data else None,
        }))
        meta = json.loads(str(raw))
        response = Response(NativeBody(self.bridge, meta['handle']), meta['url'], meta['headers'], meta['status'])
        if response.status >= 400:
            raise HTTPError(response)
        return response


def _cookiejar(bridge):
    jar = YoutubeDLCookieJar()
    for c in json.loads(str(bridge.cookies())):
        # Partitioned/first-party-isolated cookies are not portable to a generic jar.
        if c.get('partitionKey') or c.get('firstPartyDomain'):
            continue
        jar.set_cookie(http.cookiejar.Cookie(
            0, c['name'], c['value'], None, False, c['domain'], not c.get('hostOnly', False),
            c['domain'].startswith('.'), c.get('path', '/'), True, c.get('secure', False),
            int(c['expirationDate']) if c.get('expirationDate') else None,
            c.get('session', True), None, None, {'HttpOnly': c.get('httpOnly', False)}, False))
    return jar


class SilentLogger:
    def debug(self, *_): pass
    def info(self, *_): pass
    def warning(self, *_): pass
    def error(self, *_): pass



def normalize_source_url(url):
    """Canonical page identity, preserving only the selected part on video pages."""
    u = urlsplit(str(url))
    host = (u.hostname or '').lower()
    if host in ('bilibili.com', 'www.bilibili.com', 'm.bilibili.com'):
        match = re.fullmatch(r'/video/((?:BV[0-9A-Za-z]+|av[0-9]+))/?', u.path, re.I)
        if match:
            part = parse_qs(u.query).get('p', [''])[0]
            query = urlencode({'p': part}) if part.isdigit() and int(part) > 0 else ''
            return urlunsplit(('https', 'www.bilibili.com', '/video/' + match[1] + '/', query, ''))
    if host == 'player.bilibili.com' and u.path == '/player.html':
        params = parse_qs(u.query)
        identifier = params.get('bvid', [''])[0] or ('av' + params['aid'][0] if params.get('aid', [''])[0].isdigit() else '')
        if re.fullmatch(r'(?:BV[0-9A-Za-z]+|av[0-9]+)', identifier, re.I):
            return normalize_source_url('https://www.bilibili.com/video/' + identifier + '/?' + urlencode({'p':params.get('p', [''])[0]}))
    return str(url)


def _attach_playinfo_mirrors(formats, play):
    dash = (play or {}).get('dash') or {}
    streams = [*(dash.get('video') or []), *(dash.get('audio') or []),
               *((dash.get('dolby') or {}).get('audio') or []),
               (dash.get('flac') or {}).get('audio'), *((play or {}).get('durl') or [])]
    for fmt in formats:
        source = fmt.get('url')
        if not source:
            continue
        for stream in streams:
            if not isinstance(stream, dict):
                continue
            primary = stream.get('baseUrl') or stream.get('base_url') or stream.get('url')
            if primary != source:
                continue
            backups = stream.get('backupUrl') or stream.get('backup_url') or []
            if isinstance(backups, list):
                fmt['_vidown_mirrors'] = list(dict.fromkeys(u for u in backups[:8]
                    if isinstance(u, str) and u != source and urlsplit(u).scheme == 'https'
                    and urlsplit(u).hostname and not urlsplit(u).username))
            break
    return formats


class BilibiliMirrorsMixin:
    def extract_formats(self, play_info):
        return _attach_playinfo_mirrors(super().extract_formats(play_info), play_info)


class VidownBilibiliIE(BilibiliMirrorsMixin, BiliBiliIE):
    """Keep upstream extraction and the exact CDN alternatives from its API response."""


class VidownBangumiIE(BilibiliMirrorsMixin, BiliBiliBangumiIE):
    pass


def probe(url, bridge):
    opts = {'skip_download': True, 'noplaylist': True, 'quiet': True, 'no_warnings': True,
            'logger': SilentLogger(), 'socket_timeout': 30, 'cachedir': False,
            'remote_components': set(), 'js_runtimes': {}, 'extract_flat': False, 'playlistend':20}
    with YoutubeDL(opts, auto_init=False) as ydl:
        ydl.add_info_extractor(VidownBilibiliIE())
        ydl.add_info_extractor(VidownBangumiIE())
        ydl.add_default_info_extractors()
        ydl.cookiejar = _cookiejar(bridge)
        # Replace rather than append: no extractor request can fall through to another TLS/session stack.
        director = ydl._request_director
        director.close()
        director.handlers.clear()
        director.add_handler(GeckoRH(bridge, logger=SilentLogger(), cookiejar=ydl.cookiejar, headers=ydl.params['http_headers']))
        url = normalize_source_url(url)
        if (urlsplit(url).hostname or '').lower() == 'b23.tv':
            with ydl.urlopen(url) as response:
                url = normalize_source_url(response.url)
        info = ydl.extract_info(str(url), download=False)
        if any(not fmt.get('_vidown_mirrors') for fmt in info.get('formats', [])):
            _add_mirrors(info, ydl, str(url))
        if info.get('_type') in ('playlist', 'multi_video'):
            extractor = (info.get('extractor_key') or info.get('extractor') or '').lower()
            if info.get('_type') != 'multi_video' and extractor not in ('twitter', 'generic'):
                raise ValueError('首版不抓取合集或频道，请粘贴单条媒体链接')
            entries = [e for e in info.get('entries', []) if e]
            if not entries or len(entries) > 20:
                raise ValueError('单条消息中的媒体数量超出限制，请在浏览器中选择具体媒体')
            values = []
            for e in entries:
                if e.get('_type') in ('url', 'url_transparent'):
                    e = ydl.extract_info(e['url'], download=False)
                values.append(_asset(e))
            return json.dumps({'entries':values})
        return json.dumps(_asset(info))


def _add_mirrors(info, ydl, page_url):
    """Read JSON data, never evaluate page scripts. Mirrors are optional metadata."""
    host = urlsplit(page_url).hostname or ''
    if not (host in ('bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv')):
        return
    try:
        with ydl.urlopen(page_url) as response:
            data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            return
        match = re.search(r'window\.__playinfo__\s*=\s*(\{.+?\})\s*;?\s*</script>', data.decode('utf-8'), re.S)
        if not match:
            return
        dash = json.loads(match[1]).get('data', {}).get('dash', {})
        streams = [*dash.get('video', []), *dash.get('audio', []),
                   *(dash.get('dolby') or {}).get('audio', []),
                   *((dash.get('flac') or {}).get('audio'),)]
        for fmt in info.get('formats', []):
            source = fmt.get('url', '')
            codec = fmt.get('vcodec') if fmt.get('vcodec') != 'none' else fmt.get('acodec')
            for stream in streams[:250]:
                if not isinstance(stream, dict):
                    continue
                primary = stream.get('baseUrl') or stream.get('base_url') or ''
                if (urlsplit(primary).path != urlsplit(source).path or
                        codec and codec != 'none' and codec.lower() != str(stream.get('codecs', '')).lower()):
                    continue
                backups = stream.get('backupUrl') or stream.get('backup_url') or []
                if not isinstance(backups, list):
                    continue
                fmt['_vidown_mirrors'] = list(dict.fromkeys(u for u in [*fmt.get('_vidown_mirrors', []), primary, *backups[:7]]
                    if isinstance(u, str) and u != source and urlsplit(u).scheme == 'https' and
                    urlsplit(u).hostname and not urlsplit(u).username))
                break
    except Exception:
        # A missing/changed page metadata block never removes extracted tracks.
        return


def _asset(info):
    if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
        raise ValueError('首版只保存点播媒体，不进行直播录制')
    tracks = []
    for fmt in info.get('formats') or [info]:
        media_url = fmt.get('url')
        if not media_url or urlsplit(media_url).scheme not in ('http', 'https') or fmt.get('has_drm') or fmt.get('ext') in ('html', 'htm'):
            continue
        vcodec, acodec = fmt.get('vcodec'), fmt.get('acodec')
        if vcodec == acodec == 'none' or fmt.get('ext') == 'mhtml':
            continue
        # Missing codec metadata is not proof that an independent video contains sound.
        video = vcodec != 'none' if vcodec else bool(fmt.get('width') or fmt.get('height') or fmt.get('video_ext') not in (None, 'none'))
        audio = acodec != 'none' if acodec else vcodec == 'none' and bool(fmt.get('abr') or fmt.get('audio_ext') not in (None, 'none') or fmt.get('resolution') == 'audio only')
        if not video and not audio:
            continue
        unknown_muxed = video and not vcodec and not acodec
        kind = 'MUXED' if video and (audio or unknown_muxed) else 'VIDEO' if video else 'AUDIO'
        protocol = fmt.get('protocol', '')
        protocol = 'HLS' if 'm3u8' in protocol else 'DASH' if 'dash' in protocol else 'HTTP'
        if protocol == 'DASH' and not fmt.get('manifest_url'):
            # Fragment-only extractor records cannot be treated as a full MPD.
            continue
        tracks.append({'id':'track-' + str(len(tracks)), 'kind':kind, 'protocol':protocol,
            'url':fmt.get('manifest_url') if protocol == 'DASH' else media_url,
            'selector':str(fmt.get('format_id') or ''), 'width':fmt.get('width'), 'height':fmt.get('height'),
            'fps':fmt.get('fps'), 'codec':vcodec if kind != 'AUDIO' else acodec,
            'bitrate':round((fmt.get('tbr') or fmt.get('abr') or fmt.get('vbr') or 0)*1000) or None,
            'sampleRate':fmt.get('asr'), 'channels':fmt.get('audio_channels'),
            'bitDepth':fmt.get('audio_bit_depth'),
            'dynamicRange':fmt.get('dynamic_range'), 'language':fmt.get('language'),
            'label':fmt.get('format_note') or fmt.get('format') or str(fmt.get('format_id')),
            'fallbacks':fmt.get('_vidown_mirrors', []),
            'headers':fmt.get('http_headers') or info.get('http_headers') or {}})
    if not tracks:
        raise ValueError('源未返回可保存的媒体轨道，可能需要登录、权限或提取器更新')
    return {'title':info.get('title') or '媒体', 'duration':info.get('duration'), 'tracks':tracks}
