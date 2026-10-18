#!/usr/bin/env python3
"""Package corresponding native sources and Android rebuild materials, excluding secrets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]
EXCLUDE={'.git','.gradle','.kotlin','.cxx','build','native-build','third-party','__pycache__','captures'}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    destination=Path(args.output).resolve()
    destination.parent.mkdir(parents=True,exist_ok=True)
    lock=json.loads((ROOT/'tools/sources.lock.json').read_text())
    for name,item in lock.items():
        archive=ROOT/'third-party'/f'{name}.archive'
        with archive.open('rb') as f:
            if hashlib.file_digest(f,'sha256').hexdigest()!=item['sha256']:
                raise RuntimeError('Corresponding source missing or modified: '+name)
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for path in sorted(ROOT.rglob('*')):
            rel=path.relative_to(ROOT)
            if any(part in EXCLUDE for part in rel.parts) or not path.is_file():continue
            if path.name=='local.properties' or path.suffix in ('.jks','.keystore','.apk','.aab','.pyc'):continue
            name='android/'+rel.as_posix()
            if path.name=='gradlew' or path.suffix=='.sh':
                entry=zipfile.ZipInfo.from_file(path,name)
                entry.external_attr=(0o100755<<16)
                entry.create_system=3
                entry.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(entry,path.read_bytes())
            else:z.write(path,name)
        for name in lock:z.write(ROOT/'third-party'/f'{name}.archive',f'android/third-party/{name}.archive')
        z.write(ROOT.parent/'LICENSE','LICENSE')
        z.writestr('BUILD-MATERIALS.txt',
            'Vidown Android corresponding source and rebuild materials\n\n'
            'Start with android/README.md and android/THIRD_PARTY.md. Original archives are included; '
            'tools/prepare-sources.py verifies them and applies the documented cache-IO patches. '
            'FFmpeg is built as replaceable LGPL shared libraries. All application/JNI source is included. '
            'You may rebuild and re-sign a modified APK for your own device. Android signing keys and '
            'local account/device data are intentionally excluded. Gecko/Python source references and '
            'individual runtime notices are provided separately in the source tree.\n')
    print(f'Materials: {destination.name} ({destination.stat().st_size} bytes)')


if __name__=='__main__':main()
