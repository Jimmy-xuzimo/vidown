#!/usr/bin/env python3
"""Collect runtime dependency notices, not build-tool licenses, before distribution.

Run after assembling the debug app, when its pinned artifacts are in Gradle's
cache. Sources are HTTPS and hash checked. Generated notices are committed so
the APK never needs to fetch license text at runtime.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get('GRADLE_USER_HOME', Path.home()/'.gradle'))/'caches/modules-2/files-2.1'
ASSETS = ROOT/'app/src/main/assets'
SOURCES = {
    'CPython 3.12.15': ('https://raw.githubusercontent.com/python/cpython/v3.12.15/LICENSE', '3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf'),
    'Chaquopy 17.1.0': ('https://raw.githubusercontent.com/chaquo/chaquopy/17.1.0/LICENSE.txt', '345a9fdfeed355d37b18569ef277ba56eb0ab7c0b17a08a90163ce8d33d2b862'),
    'Apache License 2.0': ('https://www.apache.org/licenses/LICENSE-2.0.txt', 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'),
    'Mozilla Public License 2.0': ('https://www.mozilla.org/media/MPL/2.0/index.815ca599c9df.txt', 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85'),
    'CPython dependency libffi 3.4.4': ('https://raw.githubusercontent.com/libffi/libffi/v3.4.4/LICENSE', '2c9c2acb9743e6b007b91350475308aee44691d96aa20eacef8e199988c8c388'),
    'CPython dependency XZ liblzma 5.4.6': ('https://raw.githubusercontent.com/tukaani-project/xz/v5.4.6/COPYING', '29a1e305b2e34eefe5d4602d00cde1d528b71c5d9f2eec5106972cf6ddb6f73f'),
    'CPython dependency OpenSSL 3.5.9': ('https://raw.githubusercontent.com/openssl/openssl/openssl-3.5.9/LICENSE.txt', '7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a'),
    'CPython dependency bzip2 1.0.8': ('https://raw.githubusercontent.com/libarchive/bzip2/bzip2-1.0.8/LICENSE', 'c6dbbf828498be844a89eaa3b84adbab3199e342eb5cb2ed2f0d4ba7ec0f38a3'),
}


def collect():
    notices = {}
    inventory = []
    def add(label, data):
        text = data.decode('utf-8', errors='replace').strip()
        if text:
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest in notices:
                notices[digest][0].append(label)
            else:
                notices[digest] = ([label], text)
    def scan(label, archive):
        with zipfile.ZipFile(archive) as z:
            for entry in z.infolist():
                name = entry.filename
                if re.search(r'(^|/)(LICENSE|COPYING|NOTICE)([./_-]|$)', name, re.I) and entry.file_size < 4*1024*1024:
                    add(f'{label} / {name}', z.read(entry))
                if name.endswith('/omni.ja') or name == 'assets/omni.ja':
                    with zipfile.ZipFile(io.BytesIO(z.read(entry))) as omni:
                        add(label+' / Gecko third-party license.html', omni.read('chrome/toolkit/content/global/license.html'))
                if name == 'classes.jar' or name.endswith('.imy'):
                    scan(label+' / '+name, io.BytesIO(z.read(entry)))
    for label, (url, digest) in SOURCES.items():
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(4*1024*1024)
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError('License source checksum changed: '+label)
        add(label+' / '+url, data)
    for line in (ROOT/'app/gradle.lockfile').read_text().splitlines():
        if '=empty' in line or not re.match(r'[^#\s]+:[^:]+:[^=]+=', line) or 'releaseRuntimeClasspath' not in line:
            continue
        coordinate=line.split('=')[0]
        group, module, version=coordinate.split(':')
        folder=CACHE/group/module/version
        artifacts=[]
        for path in sorted(folder.glob('*/*')):
            if path.suffix in ('.aar', '.jar') and not path.name.endswith(('-sources.jar','-javadoc.jar')):
                artifacts.append({'name':path.name,'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest()})
                scan(coordinate,path)
        inventory.append({'coordinate':coordinate,'artifacts':artifacts})
    for path in sorted((ROOT/'app/build/python/pip/debug/common').rglob('*')):
        if path.is_file() and re.match(r'(?i)^(license|notice|copying)',path.name):
            add('Python package / '+path.relative_to(ROOT/'app/build/python/pip/debug/common').as_posix(),path.read_bytes())
    apk=ROOT/'app/build/outputs/apk/debug/app-debug.apk'
    if not apk.exists():raise RuntimeError('Assemble the debug APK before collecting packaged runtime notices')
    scan('Packaged APK',apk)
    if not inventory or not any('yt_dlp' in item for values,_ in notices.values() for item in values):
        raise RuntimeError('Build the pinned debug Python/runtime dependencies first')
    text='Vidown Android supplementary runtime notices\n\n'
    text+='License wording is retained; trailing spaces are normalized. HTML is preserved as source.\n\n'
    text+='\n\n'.join('\n'.join('===== '+label+' =====' for label in labels)+'\n'+body for labels,body in notices.values())
    text='\n'.join(line.rstrip(' \t') for line in text.splitlines())
    (ASSETS/'component-notices.txt').write_text(text+'\n',encoding='utf-8')
    (ASSETS/'components.json').write_text(json.dumps({'runtime':inventory,'licenseSources':SOURCES},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Collected {len(notices)} unique notices for {len(inventory)} runtime coordinates')


if __name__ == '__main__':
    collect()
