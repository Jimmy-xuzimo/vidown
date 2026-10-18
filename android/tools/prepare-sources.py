#!/usr/bin/env python3
"""Download pinned source, verify before extraction, retain corresponding source."""
import hashlib, json, pathlib, tarfile, urllib.request
root = pathlib.Path(__file__).resolve().parents[1]
lock = json.loads((root / 'tools/sources.lock.json').read_text())
for name, record in lock.items():
    archive = root / 'third-party' / (name + '.archive')
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        print('Downloading', name, flush=True)
        urllib.request.urlretrieve(record['url'], archive)
    with archive.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != record['sha256']:
            raise RuntimeError('Source checksum mismatch: ' + name)
    target = root / 'third-party' / name
    if target.exists():
        continue
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            parts = pathlib.PurePosixPath(member.name).parts
            if len(parts) > 1:
                member.name = str(pathlib.PurePosixPath(*parts[1:]))
                source.extract(member, target, filter='data')
    print('Verified', name, flush=True)

# HLS validates schemes against the built-in protocols even with custom IO.
# Recognize cached HTTP(S) URLs here without enabling a network stack. All IO
# still goes through the task's registered-resource cache callback.
paths = [root / 'third-party/ffmpeg/libavformat' / name for name in ('hls.c', 'dashdec.c')]
original = '    if (!proto_name)\n        return AVERROR_INVALIDDATA;'
patched = '''    /* Vidown: recognize cached HTTP(S) without enabling network IO. */
    if (!proto_name || !strcmp(proto_name, "crypto")) {
        const char *plain = av_strstart(url, "crypto+", NULL) ? url + 7 : url;
        if (av_strstart(plain, "https://", NULL)) proto_name = "https";
        else if (av_strstart(plain, "http://", NULL)) proto_name = "http";
    }
    if (!proto_name)
        return AVERROR_INVALIDDATA;'''
for hls in paths:
    content = hls.read_text(encoding="utf-8").replace('if (!proto_name) {\n        const char *plain', 'if (!proto_name || !strcmp(proto_name, "crypto")) {\n        const char *plain')
    if patched in content:
        if content != hls.read_text(encoding="utf-8"): hls.write_text(content, encoding="utf-8")
    if patched not in content:
        if content.count(original) != 1:
            raise RuntimeError('Pinned FFmpeg cache patch no longer applies: ' + hls.name)
        hls.write_text(content.replace(original, patched), encoding="utf-8")
