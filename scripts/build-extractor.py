"""Build a private, isolated yt-dlp executable and retain exact dependency sources.

Run only in the release runner's dedicated Python environment. Does not read
browser profiles. Runtime includes the pinned default extras and EJS, no curl-cffi.
"""
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

ROOT = Path.cwd()
SOURCES = ROOT / 'work/corresponding-source'
TOOLS = ROOT / 'resources/tools'
REV = '3a08beaf031ab68f966401ead017ac81fe8486cf'
SOURCES.mkdir(parents=True, exist_ok=True)
TOOLS.mkdir(parents=True, exist_ok=True)
NOTICES = TOOLS / 'licenses/extractor'
NOTICES.mkdir(parents=True, exist_ok=True)
receipts = []


def download(url, name, expected=None):
    target = SOURCES / name
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as response:
                data = response.read()
            digest = hashlib.sha256(data).hexdigest()
            if expected and digest != expected:
                raise ValueError(f'Source checksum mismatch: {name}')
            target.write_bytes(data)
            receipts.append(dict(file=name, url=url, sha256=digest))
            return target
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    raise RuntimeError('Source download retry loop exhausted')


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


archive = download(f'https://codeload.github.com/yt-dlp/yt-dlp/tar.gz/{REV}', f'yt-dlp-{REV}.tar.gz')
src = ROOT / 'work/extractor-build'
src.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as tf:
    tf.extractall(src, filter='data')
src = src / f'yt-dlp-{REV}'
run(sys.executable, '-m', 'pip', 'install', f'{src}[default,pin]', 'pyinstaller==6.22.0')

# Archive exact sdists rather than merely referring to today's upstream branches.
installed = sorted(metadata.distributions(), key=lambda d: d.metadata['Name'].lower())
inventory = []
for dist in installed:
    name, version = dist.metadata['Name'], dist.version
    inventory.append(dict(name=name, version=version))
    if name.lower().replace('_', '-') != 'yt-dlp':
        with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=60) as response:
            info = json.load(response)
        source = next((f for f in info['urls'] if f['packagetype'] == 'sdist'), None)
        if not source:
            raise RuntimeError(f'No corresponding source distribution: {name} {version}')
        download(source['url'], source['filename'], source['digests']['sha256'])
    for file in dist.files or []:
        if any(part.lower().startswith(('license', 'copying', 'notice')) for part in file.parts):
            original = Path(dist.locate_file(file))
            if original.is_file():
                target = NOTICES / name / str(file)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(original, target)

python_version = platform.python_version()
python_source = download(f'https://www.python.org/ftp/python/{python_version}/Python-{python_version}.tar.xz', f'Python-{python_version}.tar.xz')
with tarfile.open(python_source) as tf:
    (NOTICES / 'Python-LICENSE.txt').write_bytes(tf.extractfile(f'Python-{python_version}/LICENSE').read())
    if os.name == 'nt':
        (NOTICES / 'Python-Microsoft-runtime.txt').write_bytes(tf.extractfile(f'Python-{python_version}/PC/crtlicense.txt').read())
shutil.copyfile(src / 'LICENSE', NOTICES / 'yt-dlp-Unlicense.txt')
# Keep runtime license with the executable as well as inside the source archive.
for file in ('LICENSE.txt', 'LICENSE'):
    original = Path(sys.base_prefix) / file
    if original.is_file():
        shutil.copyfile(original, NOTICES / 'Python-LICENSE.txt')

license_text = '\n\n'.join(f'{file.relative_to(NOTICES)}\n{file.read_text(errors="replace")}' for file in NOTICES.rglob('*') if file.is_file())
(src / 'THIRD_PARTY_LICENSES.txt').write_text(license_text, encoding='utf-8')
run(sys.executable, '-m', 'devscripts.make_lazy_extractors', cwd=src)
# Readline is an interactive REPL dependency, not used by the CLI. Avoid bundling
# the runner's unrelated readline/Tk libraries into a media extraction tool.
run(sys.executable, 'bundle/pyinstaller.py', '--exclude-module=readline', '--exclude-module=rlcompleter', '--exclude-module=tkinter', cwd=src)
binary = next(p for p in (src / 'dist').iterdir() if p.is_file() and p.name.startswith('yt-dlp'))
target = TOOLS / ('yt-dlp.exe' if os.name == 'nt' else 'yt-dlp')
shutil.copyfile(binary, target)
target.chmod(0o755)
run(str(target), '--version')
build = dict(python=python_version, sourceRevision=REV, dependencies=inventory, sources=receipts,
             sha256=hashlib.sha256(target.read_bytes()).hexdigest(), license='Unlicense + bundled component licenses; includes GPL mutagen',
             optionalImpersonation=False)
(SOURCES / 'extractor-build.json').write_text(json.dumps(build, indent=2), encoding='utf-8')
shutil.copyfile(ROOT / 'scripts/build-extractor.py', SOURCES / 'build-extractor.py')
shutil.copyfile(SOURCES / 'extractor-build.json', TOOLS / 'extractor-build.json')
