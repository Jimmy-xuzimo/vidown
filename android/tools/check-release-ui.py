#!/usr/bin/env python3
"""Black-box checks of an actual release APK using Android's accessibility tree.

No in-app test hooks, debug flags, account credentials or run-as access. Run only
on a dedicated emulator. Files come solely from the local synthetic fixture.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
PACKAGE='top.xuzimo.vidown'


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--serial',required=True)
    parser.add_argument('--adb',default='adb')
    parser.add_argument('--ffprobe',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--fresh',action='store_true',help='Clear private app data on a dedicated test emulator only')
    parser.add_argument('--public-bilibili',action='store_true',help='Opt in to a complete public 219-second sample download; no account')
    args=parser.parse_args()
    if not args.serial.startswith('emulator-'):parser.error('Use a dedicated emulator')
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    (out/'summary.json').unlink(missing_ok=True)
    def adb(*parts):
        return subprocess.run([args.adb,'-s',args.serial,*parts],check=True,capture_output=True,text=True,encoding='utf-8',errors='replace').stdout
    if args.install:
        if 'Success' not in adb('install','-r',str(ROOT/'android/app/build/outputs/apk/release/app-release.apk')):
            raise RuntimeError('Release APK installation failed')
    if args.fresh:
        name=adb('emu','avd','name').splitlines()[0]
        if not name.startswith('Vidown_') and not __import__('os').environ.get('CI'):
            raise RuntimeError('Refusing to clear an emulator outside the dedicated Vidown test set')
        adb('shell','pm','clear',PACKAGE)
    if int(adb('shell','getprop','ro.build.version.sdk').strip())>=37:
        # Only this explicit emulator fixture run uses local-network access.
        adb('shell','pm','grant',PACKAGE,'android.permission.ACCESS_LOCAL_NETWORK')
    def tree():
        adb('shell','uiautomator','dump','/sdcard/vidown-release-test.xml')
        return list(ET.fromstring(adb('shell','cat','/sdcard/vidown-release-test.xml')).iter('node'))
    def tap(node):
        coords=list(map(int,re.findall(r'\d+',node.get('bounds'))))
        adb('shell','input','tap',str((coords[0]+coords[2])//2),str((coords[1]+coords[3])//2))
    def wait(predicate,timeout=90):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            nodes=tree()
            result=predicate(nodes)
            if isinstance(result,ET.Element) or result:return result
            time.sleep(.5)
        (out/'failed-tree.xml').write_text(adb('shell','cat','/sdcard/vidown-release-test.xml'),encoding='utf-8')
        raise RuntimeError('Release UI did not reach its expected state')
    def text(value):return wait(lambda nodes:next((n for n in reversed(nodes) if n.get('text')==value and n.get('enabled')=='true'),None))
    def edit(url):
        # The pager preserves the workbench scroll position. Return to the link
        # card before selecting an EditText: format dropdowns use that class too.
        for _ in range(8):
            nodes=tree()
            if any(n.get('text')=='添加媒体链接' for n in nodes):break
            bounds=list(map(int,re.findall(r'\d+',nodes[0].get('bounds'))))
            adb('shell','input','swipe',str(bounds[2]//2),str(bounds[3]//3),str(bounds[2]//2),str(bounds[3]*3//4),'300')
        else:raise RuntimeError('Link card is not reachable by scrolling')
        node=wait(lambda nodes:next((n for n in nodes if n.get('class')=='android.widget.EditText' and n.get('enabled')=='true'),None))
        tap(node)
        # IMEs/Compose may consume Ctrl+A differently. Clear both sides of the
        # caret using Android key events, then confirm the actual field value.
        count=len(node.get('text',''))+1
        if count>1000:raise RuntimeError('Unexpected fixture input length')
        adb('shell','input','keyevent',*(['67']*count+['112']*count))
        adb('shell','input','text',url);adb('shell','input','keyevent','4')
        wait(lambda nodes:any(n.get('class')=='android.widget.EditText' and n.get('text')==url for n in nodes))
    def screenshot(name):
        data=subprocess.run([args.adb,'-s',args.serial,'exec-out','screencap','-p'],check=True,capture_output=True).stdout
        (out/(name+'.png')).write_bytes(data)
    def files():
        try:return set(adb('shell','find','/sdcard/Movies/Vidown','-type','f').splitlines())
        except subprocess.CalledProcessError as e:
            if 'No such file' in e.stderr:return set()
            raise
    adb('shell','am','force-stop',PACKAGE)
    start=adb('shell','am','start','-W','-n',PACKAGE+'/.MainActivity')
    (out/'startup.txt').write_text(start)
    tap(text('工作台'))
    # Ensure the directory exists without writing into arbitrary shared folders.
    existing=files()
    def download(url,label,public=False):
        tap(text('历史'))
        old_completed=sum(n.get('text')=='完成' for n in tree())
        tap(text('工作台'))
        edit(url);tap(text('解析链接'))
        wait(lambda nodes:not any(n.get('class')=='android.widget.EditText' and n.get('focused')=='true' for n in nodes))
        # Wait for extraction independently of scrolling; cold engine startup
        # and the larger native cards can both take time on an emulator.
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            nodes=tree()
            button=next((n for n in nodes if n.get('text')=='加入队列' and n.get('enabled')=='true'),None)
            if button is not None:break
            if any(n.get('text')=='正在解析' for n in nodes):
                time.sleep(.5);continue
            bounds=list(map(int,re.findall(r'\d+',nodes[0].get('bounds'))))
            adb('shell','input','swipe',str(bounds[2]//2),str(bounds[3]*3//4),str(bounds[2]//2),str(bounds[3]//3),'300')
        else:
            (out/'format-failure-tree.xml').write_text(adb('shell','cat','/sdcard/vidown-release-test.xml'),encoding='utf-8')
            screenshot('format-failure')
            raise RuntimeError('No actionable format-selection card')
        screenshot(label+'-formats')
        selected=[n.get('text','') for n in nodes if n.get('class')=='android.widget.EditText']
        tap(button)
        # Fresh install can display the notification permission prompt.
        time.sleep(1)
        for node in tree():
            if node.get('resource-id')=='com.android.permissioncontroller:id/permission_allow_button':tap(node);break
        tap(text('历史'))
        def completed(nodes):
            if any(n.get('text')=='失败' for n in nodes):
                (out/'failure.xml').write_text('\n'.join(n.get('text','') for n in nodes),encoding='utf-8')
                raise RuntimeError('A real release download failed')
            return sum(n.get('text')=='完成' for n in nodes)>old_completed and files()-existing
        wait(completed,300 if public else 120)
        screenshot(label)
        new=files()-existing
        if not new:raise RuntimeError('UI reported completion without a shared media file')
        reports=[]
        for remote in new:
            if not remote.startswith('/sdcard/Movies/Vidown/'):raise RuntimeError('Unexpected publication location')
            local=out/Path(remote).name
            adb('pull',remote,str(local))
            report=json.loads(subprocess.check_output([args.ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(local)],encoding='utf-8'))
            video=[s for s in report['streams'] if s['codec_type']=='video']
            audio=[s for s in report['streams'] if s['codec_type']=='audio']
            assert len(video)==len(audio)==1
            if public:
                expected=next((re.search(r'(\d+)p',t,re.I) for t in selected if re.search(r'(\d+)p',t,re.I)),None)
                assert expected and video[0]['height']==int(expected[1])
                expected_codec=next((name for marker,name in [('hev1','hevc'),('avc1','h264'),('av01','av1')] if any(marker in t for t in selected)),None)
                assert expected_codec and video[0]['codec_name']==expected_codec
                assert audio[0]['codec_name']=='aac'
                assert abs(float(report['format']['duration'])-219)<1
            else:
                assert video[0]['width']==320 and video[0]['height']==180
                assert video[0]['codec_name']=='h264' and audio[0]['codec_name']=='aac'
                assert abs(float(report['format']['duration'])-8)<.4
            reports.append({'file':local.name,'bytes':local.stat().st_size,'duration':report['format']['duration'],
                'width':video[0]['width'],'height':video[0]['height'],'videoCodec':video[0]['codec_name'],'audioCodec':audio[0]['codec_name']})
        existing.update(new)
        print(label+': actual file verified',flush=True)
        return reports
    hls=download('http://10.0.2.2:18763/split/master.m3u8','hls')
    tap(text('工作台'))
    edit('http://10.0.2.2:18763/login');tap(text('在浏览器中打开'))
    wait(lambda nodes:any('Signed in' in n.get('text','') for n in nodes),60)
    screenshot('browser-login')
    # The fixture uses a session Cookie. A process restart must restore it from
    # the private encrypted snapshot, not from an exported external-browser jar.
    time.sleep(3)
    adb('shell','am','force-stop',PACKAGE)
    adb('shell','am','start','-W','-n',PACKAGE+'/.MainActivity')
    auth=download('http://10.0.2.2:18763/auth/page','authenticated-after-restart')
    result={'variant':'release','serial':args.serial,'passed':True,'scope':'black-box HLS independent video/audio, browser session login, process restart, authenticated download, native remux, MediaStore, host ffprobe','hls':hls,'authenticated':auth}
    if args.public_bilibili:
        result['publicBilibili']=download('https://www.bilibili.com/video/BV1NGZtBwELa/','public-bilibili',True)
        result['publicScope']='One public sample without login; complete download and ffprobe comparison to selected format; premium formats and physical devices not tested'
    (out/'summary.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
