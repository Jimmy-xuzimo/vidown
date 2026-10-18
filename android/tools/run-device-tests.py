#!/usr/bin/env python3
"""Run the packaged acceptance suite against one explicitly selected emulator."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--serial',default=os.environ.get('ANDROID_SERIAL'))
    parser.add_argument('--adb',default='adb')
    parser.add_argument('--output',default='work/android-device-tests')
    parser.add_argument('--class',dest='test_class')
    parser.add_argument('--public-network',action='store_true')
    layout=parser.add_mutually_exclusive_group()
    layout.add_argument('--landscape',action='store_true',help='Request and assert landscape through the UI tests')
    layout.add_argument('--portrait',action='store_true',help='Request and assert portrait through the UI tests')
    args=parser.parse_args()
    if not args.serial or not args.serial.startswith('emulator-'):
        parser.error('Select a dedicated emulator with --serial; physical-device acceptance is separate')
    destination=(ROOT/args.output).resolve();destination.mkdir(parents=True,exist_ok=True)
    (destination/'summary.json').unlink(missing_ok=True)
    def adb(*command,check=True):
        result=subprocess.run([args.adb,'-s',args.serial,*command],text=True,encoding='utf-8',errors='replace',capture_output=True)
        if check and result.returncode:
            raise RuntimeError('ADB '+command[0]+' failed: '+(result.stdout+result.stderr)[-6000:])
        return result.stdout
    def wait_system_ready():
        # A first boot or display reconfiguration may restart system_server after
        # sys.boot_completed becomes 1. Do not race package-manager startup.
        deadline=time.monotonic()+180
        stable=0
        while time.monotonic()<deadline:
            boot=adb('shell','getprop','sys.boot_completed',check=False).strip()
            package=adb('shell','service','check','package',check=False)
            activity=adb('shell','service','check','activity',check=False)
            storage=adb('shell','stat','-L','-c','%F','/sdcard/Android/data',check=False).strip()
            stable=stable+1 if boot=='1' and ': found' in package and ': found' in activity and storage=='directory' else 0
            if stable>=5:return
            time.sleep(1)
        (destination/'provisioning-logcat.txt').write_text(adb('logcat','-d','-t','300',check=False),encoding='utf-8')
        raise RuntimeError('Emulator package/activity services or emulated storage did not stabilize')
    deadline=time.monotonic()+180
    while adb('shell','getprop','sys.boot_completed',check=False).strip()!='1':
        if time.monotonic()>=deadline:raise RuntimeError('Emulator did not finish booting')
        time.sleep(1)
    api=adb('shell','getprop','ro.build.version.sdk').strip()
    page_size=adb('shell','getconf','PAGE_SIZE').strip()
    name=adb('emu','avd','name').splitlines()[0]
    if not name.startswith('Vidown_') and not os.environ.get('CI'):
        raise RuntimeError('Select a dedicated Vidown emulator')
    if not 34<=int(api)<=37:raise RuntimeError(f'Unexpected emulator API {api}')
    wait_system_ready()
    # This script never closes an existing server or changes a browser profile.
    with urllib.request.urlopen('http://127.0.0.1:18763/health',timeout=10) as response:
        if json.load(response).get('fixture')!='vidown-android-v1':raise RuntimeError('Unexpected fixture listener')
    # Release is tested externally with check-release-ui.py so in-process test
    # dependencies do not alter the production shrinker's reachability graph.
    variant='debug'
    install_retries=0
    for apk in [f'app/build/outputs/apk/{variant}/app-{variant}.apk',f'app/build/outputs/apk/androidTest/{variant}/app-{variant}-androidTest.apk']:
        for attempt in range(3):
            result=subprocess.run([args.adb,'-s',args.serial,'install','-r',str(ROOT/'android'/apk)],text=True,encoding='utf-8',errors='replace',capture_output=True)
            details=result.stdout+result.stderr
            if result.returncode==0 and 'Success' in details:break
            (destination/'install-failure.txt').write_text(details,encoding='utf-8')
            (destination/'provisioning-logcat.txt').write_text(adb('logcat','-d','-t','200',check=False),encoding='utf-8')
            transient=any(s in details.lower() for s in ('device offline','broken pipe',"can't find service",'device not found','failed to read response'))
            if not transient or attempt==2:raise RuntimeError('APK installation failed: '+details[-6000:])
            install_retries+=1
            print('Emulator service restarted during provisioning; waiting before reinstall',flush=True)
            wait_system_ready()
    wait_system_ready()
    if args.public_network:
        if int(api)<37:raise RuntimeError('The local-network permission test requires API 37')
        adb('shell','pm','revoke','top.xuzimo.vidown','android.permission.ACCESS_LOCAL_NETWORK')
        args.test_class='top.xuzimo.vidown.PublicNetworkIntegrationTest'
    elif int(api)>=37:
        # Only the dedicated emulator grants this automatically for the host fixture.
        adb('shell','pm','grant','top.xuzimo.vidown','android.permission.ACCESS_LOCAL_NETWORK')
    # Match a real first install: activate the launcher before instrumentation
    # queries its activity. Then stop the process so startup isolation stays cold.
    first=adb('shell','am','start','-W','-n','top.xuzimo.vidown/.MainActivity',check=False)
    (destination/'first-launch.txt').write_text(first,encoding='utf-8')
    if 'Status: ok' not in first:
        (destination/'launch-package-state.txt').write_text(
            adb('shell','dumpsys','package','top.xuzimo.vidown',check=False),encoding='utf-8')
        (destination/'launch-crash-logcat.txt').write_text(
            adb('logcat','-b','crash','-d',check=False),encoding='utf-8')
        raise RuntimeError('Installed target did not launch: '+first)
    adb('shell','am','force-stop','top.xuzimo.vidown')
    command=['shell','am','instrument','-w','-r']
    # A failed test must not inherit screenshots left by an older successful run.
    adb('shell','rm','-f','/sdcard/Android/data/top.xuzimo.vidown/files/screenshots/*.png')
    if args.landscape:command+=['-e','vidownLandscape','true']
    if args.portrait:command+=['-e','vidownPortrait','true']
    if not args.test_class:
        cold=adb(*command,'-e','class','top.xuzimo.vidown.StartupIntegrationTest','top.xuzimo.vidown.test/androidx.test.runner.AndroidJUnitRunner',check=False)
        (destination/'startup.txt').write_text(cold,encoding='utf-8')
        if not re.search(r'OK \(1 test\)',cold):raise RuntimeError('Cold-start engine isolation test failed: '+cold[-4000:])
        # The isolation assertion has to execute before Gecko/Python are used.
        command+=['-e','notClass','top.xuzimo.vidown.StartupIntegrationTest,top.xuzimo.vidown.PublicNetworkIntegrationTest,top.xuzimo.vidown.BilibiliNetworkIntegrationTest']
    if args.public_network:command+=['-e','publicNetwork','true']
    if args.test_class:command+=['-e','class',args.test_class]
    command+=['top.xuzimo.vidown.test/androidx.test.runner.AndroidJUnitRunner']
    log=adb(*command,check=False);(destination/'instrumentation.txt').write_text(log,encoding='utf-8')
    match=re.search(r'OK \((\d+) tests?\)',log)
    passed=match is not None and 'FAILURES!!!' not in log and 'INSTRUMENTATION_FAILED' not in log
    scope='public HTTPS and local-network permission boundary; no live accounts' if args.public_network else 'controlled synthetic fixtures; no live accounts'
    result={'api':int(api),'pageSize':int(page_size),'serial':args.serial,'variant':variant,'tests':int(match[1]) if match else None,'passed':passed,'scope':scope}
    result['layout']='landscape asserted by UI tests' if args.landscape else 'portrait asserted by UI tests' if args.portrait else 'device default'
    font_scale=adb('shell','settings','get','system','font_scale').strip()
    result['fontScale']=float(font_scale) if font_scale not in ('', 'null') else 1.0
    result['provisioningRetries']=install_retries
    (destination/'summary.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    screenshots=destination/'screenshots';screenshots.mkdir(exist_ok=True)
    for old in screenshots.glob('*.png'):old.unlink()
    remote='/sdcard/Android/data/top.xuzimo.vidown/files/screenshots'
    for name in adb('shell','ls',remote,check=False).splitlines():
        if re.fullmatch(r'[A-Za-z0-9._-]+\.png',name):
            adb('pull',remote+'/'+name,str(screenshots/name))
    print(json.dumps(result))
    if not passed:
        print(log[-12000:]);return 1
    return 0

if __name__=='__main__':sys.exit(main())
