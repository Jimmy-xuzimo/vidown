"""Generate controlled, non-copyrighted samples and serve Android integration tests.
Usage: py -3 android/tools/fixtures.py --ffmpeg resources/tools/ffmpeg.exe
Only binds loopback. Android emulator accesses the host via 10.0.2.2:18763.
"""
import argparse
import hashlib
import json
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2] / 'work' / 'android-fixtures'
COUNTERS = {}
REQUESTS = {}
VERSIONS = {}
LOCK = threading.Lock()


def generate(ffmpeg):
    ROOT.mkdir(parents=True, exist_ok=True)
    ffmpeg = str(Path(ffmpeg).resolve())
    def run(*args,cwd=None):
        subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True,cwd=cwd)
    source = ROOT / 'sample.mp4'
    if not source.exists():
        run('-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
            '-t','8','-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-g','48','-c:a','aac','-b:a','128k','-movflags','+faststart',source)
    hdr=ROOT/'hdr10.mkv'
    hdr_version=ROOT/'hdr10.version'
    if not hdr.exists() or not hdr_version.exists() or hdr_version.read_text()!='3':
        encoded=ROOT/'hdr-encoded.mkv'
        run('-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=880:sample_rate=96000',
            '-t','8','-c:v','libx265','-preset','fast','-pix_fmt','yuv420p10le','-color_primaries','bt2020','-color_trc','smpte2084','-colorspace','bt2020nc',
            '-x265-params','log-level=error:hdr10=1:repeat-headers=1:colorprim=9:transfer=16:colormatrix=9:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400',
            '-c:a','flac','-sample_fmt','s32','-bits_per_raw_sample','24',encoded)
        # Some libx265 builds expose VUI colors only once decoding starts. Write
        # explicit container tags too: this fixture tests tagged HDR remuxing.
        run('-i',encoded,'-map','0','-c','copy','-color_primaries','bt2020',
            '-color_trc','smpte2084','-colorspace','bt2020nc',hdr)
        encoded.unlink()
        hdr_version.write_text('3')
    for kind, extra in [('hls',[]),('fmp4',['-hls_segment_type','fmp4']),('range',['-hls_flags','single_file'])]:
        directory=ROOT/kind;directory.mkdir(exist_ok=True)
        if not (directory/'index.m3u8').exists() or kind=='fmp4' and not (directory/'init.mp4').exists():
            run('-i',source,'-c','copy','-hls_time','2','-hls_list_size','0',*extra,'index.m3u8',cwd=directory)
    aes=ROOT/'aes';aes.mkdir(exist_ok=True)
    key=aes/'key.bin';key.write_bytes(bytes(range(16)))
    (aes/'key.info').write_text(f'key.bin\n{key.as_posix()}\n0123456789abcdef0123456789abcdef\n')
    if not (aes/'index.m3u8').exists():
        run('-i',source,'-c','copy','-hls_time','2','-hls_list_size','0','-hls_key_info_file',aes/'key.info',aes/'index.m3u8')
    rotation=ROOT/'rotation';rotation.mkdir(exist_ok=True)
    for index in (1,2):
        directory=rotation/f'k{index}';directory.mkdir(exist_ok=True)
        key=rotation/f'key{index}.bin';key.write_bytes(bytes(range(index*16,index*16+16)))
        iv=f'{index:032x}'
        info=directory/'key.info';info.write_text(f'../key{index}.bin\n{key.as_posix()}\n{iv}\n')
        if not (directory/'index.m3u8').exists():
            run('-i',source,'-c','copy','-hls_time','2','-hls_list_size','0','-hls_key_info_file',info,directory/'index.m3u8')
    (rotation/'index.m3u8').write_text('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI="key1.bin",IV=0x'+f'{1:032x}'+'\n#EXTINF:2,\nk1/index0.ts\n#EXTINF:2,\nk1/index1.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key2.bin",IV=0x'+f'{2:032x}'+'\n#EXTINF:2,\nk2/index2.ts\n#EXTINF:2,\nk2/index3.ts\n#EXT-X-ENDLIST\n')
    discontinuity=ROOT/'discontinuity';discontinuity.mkdir(exist_ok=True)
    # Repeat the first two segments after a real timestamp reset, rather than
    # placing a marker in a continuous timeline. Expected result remains 8s.
    playlist='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2,\n../hls/index0.ts\n#EXTINF:2,\n../hls/index1.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:2,\n../hls/index0.ts\n#EXTINF:2,\n../hls/index1.ts\n#EXT-X-ENDLIST\n'
    (discontinuity/'index.m3u8').write_text(playlist)
    split=ROOT/'split';split.mkdir(exist_ok=True)
    for name,options in [('video',['-an']),('audio',['-vn'])]:
        if not (split/f'{name}.m3u8').exists():
            run('-i',source,*options,'-c','copy','-hls_time','2','-hls_list_size','0',split/f'{name}.m3u8')
    (split/'master.m3u8').write_text('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180,FRAME-RATE=24,CODECS="avc1.64000c,mp4a.40.2",AUDIO="a"\nvideo.m3u8\n')
    dash=ROOT/'dash';dash.mkdir(exist_ok=True)
    if not (dash/'index.mpd').exists() or not (dash/'init-stream0.m4s').exists():
        run('-i',source,'-map','0:v','-map','0:a','-c','copy','-seg_duration','2','-use_template','1','-use_timeline','1','-f','dash','index.mpd',cwd=dash)
    print(f'Fixtures: {ROOT}',flush=True)


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self): self.serve(False)
    def do_GET(self): self.serve(True)
    def log_message(self,*_): pass
    def serve(self,body):
        path=urlsplit(self.path).path
        if path=='/health':return self.reply(200,b'{"fixture":"vidown-android-v1"}','application/json',body)
        original=path
        with LOCK:
            COUNTERS[path]=COUNTERS.get(path,0)+1
            REQUESTS.setdefault(path,[]).append({'method':self.command,'range':self.headers.get('Range')})
        if path=='/counts':return self.reply(200,json.dumps(COUNTERS).encode(),'application/json',body)
        if path=='/requests':
            with LOCK: snapshot=json.dumps(REQUESTS).encode()
            return self.reply(200,snapshot,'application/json',body)
        if path=='/cross-redirect':
            self.send_response(302);self.send_header('Location','http://10.0.2.2:18764/headers');self.end_headers();return
        if path=='/headers':return self.reply(200,json.dumps(dict(self.headers)).encode(),'application/json',body)
        if path=='/desktop-extractor-page':
            ua=self.headers.get('User-Agent','')
            if 'Android' in ua or not self.headers.get('Accept-Language'):
                return self.reply(400,b'Extractor defaults were lost','text/plain',body)
            return self.reply(200,b'<html><title>Desktop session fixture</title><video src="/sample.mp4"></video></html>','text/html',body)
        if path=='/fake-media.mp4':return self.reply(200,b'<!DOCTYPE html><html>Sign in to continue</html>','text/html',body)
        if path=='/evil.mpd':return self.reply(200,b'<!DOCTYPE MPD [<!ENTITY secret SYSTEM "file:///data/local/tmp/private">]><MPD xmlns="urn:mpeg:dash:schema:mpd:2011">&secret;</MPD>','application/dash+xml',body)
        case=None
        match_case=re.match(r'^/case/([a-f0-9-]+)/(.+)$',path)
        if match_case:
            case=match_case[1];path='/'+match_case[2]
            if path=='/mutate':
                with LOCK: VERSIONS[case]=VERSIONS.get(case,0)+1
                return self.reply(200,b'changed','text/plain',body)
        slow=path.startswith('/slow/')
        if slow:path=path[5:]
        if path=='/login':
            self.send_response(200);self.send_header('Set-Cookie','fixture_login=yes; Path=/; HttpOnly; SameSite=Lax');self.send_header('Content-Type','text/html');self.end_headers()
            if body:self.wfile.write(b'<html><title>Controlled login</title><body>Signed in<video controls src="/auth/sample.mp4"></video><script>fetch("/auth/hls/index.m3u8")</script></body></html>')
            return
        if path=='/browser-layout':return self.reply(200,b'<html><meta name="viewport" content="width=device-width,initial-scale=1"><body>Controlled desktop layout<script>function report(){document.title="Layout "+innerWidth+" "+navigator.userAgent;} addEventListener("resize",report); new ResizeObserver(report).observe(document.documentElement); report();</script></body></html>','text/html',body)
        if path=='/page':return self.reply(200,b'<html><title>Fixture video</title><body><video controls src="/sample.mp4"></video></body></html>','text/html',body)
        if path=='/auth/page':
            if 'fixture_login=yes' not in self.headers.get('Cookie',''):return self.reply(403,b'Login required','text/plain',body)
            return self.reply(200,b'<html><title>Protected fixture video</title><body><video controls src="/auth/sample.mp4"></video></body></html>','text/html',body)
        if path=='/blob-page':return self.reply(200,(Path(__file__).parent/'fixtures'/'blob-save.html').read_bytes(),'text/html',body)
        if path.startswith('/auth/'):
            if 'fixture_login=yes' not in self.headers.get('Cookie',''):return self.reply(403,b'Login required','text/plain',body)
            path=path[5:]
        if path=='/expired':return self.reply(403,b'Expired','text/plain',body)
        if path=='/limited':return self.reply(429,b'Rate limited','text/plain',body)
        target=(ROOT/path.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT.resolve()) or not target.is_file() or target.suffix in ('.info',):return self.reply(404,b'Not found','text/plain',body)
        data=target.read_bytes()
        mime={'.mp4':'video/mp4','.m3u8':'application/vnd.apple.mpegurl','.mpd':'application/dash+xml','.ts':'video/mp2t','.m4s':'video/iso.segment','.bin':'application/octet-stream'}.get(target.suffix,'application/octet-stream')
        etag='"'+hashlib.sha256(data).hexdigest()+str(VERSIONS.get(case,0))+'"'
        match=re.fullmatch(r'bytes=(\d+)-(\d*)',self.headers.get('Range',''))
        start,end=(int(match[1]),int(match[2] or len(data)-1)) if match else (0,len(data)-1)
        if start>=len(data) or end<start:
            self.send_response(416);self.send_header('Content-Range',f'bytes */{len(data)}');self.end_headers();return
        end=min(end,len(data)-1)
        self.send_response(206 if match else 200);self.send_header('Content-Type',mime);self.send_header('ETag',etag);self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1))
        if match:self.send_header('Content-Range',f'bytes {start}-{end}/{len(data)}')
        self.end_headers()
        if body:
            try:
                if slow:
                    for offset in range(start,end+1,8192):
                        self.wfile.write(data[offset:min(offset+8192,end+1)]);self.wfile.flush();time.sleep(.01 if path.endswith('index0.ts') else .08)
                else:self.wfile.write(data[start:end+1])
            except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
    def reply(self,status,data,mime,body):
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.end_headers()
        if body:self.wfile.write(data)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--ffmpeg',required=True);args=parser.parse_args();generate(args.ffmpeg)
    print('Listening on 127.0.0.1:18763',flush=True)
    other=ThreadingHTTPServer(('127.0.0.1',18764),Handler)
    threading.Thread(target=other.serve_forever,daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1',18763),Handler).serve_forever()
