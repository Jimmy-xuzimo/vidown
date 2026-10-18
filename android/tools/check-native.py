#!/usr/bin/env python3
"""Verify every ELF (including Python's nested archives) and APK 16KB mapping.
No host readelf required. Reject 32-bit/unexpected ABIs and non-aligned PT_LOADs.
"""
import argparse
import io
import json
import struct
import zipfile
from pathlib import Path


def inspect_elf(name, data):
    if data[:4] != b'\x7fELF':
        raise ValueError(f'{name}: not ELF')
    if data[4:6] != b'\x02\x01':
        raise ValueError(f'{name}: requires ELF64 little endian')
    offset = struct.unpack_from('<Q', data, 32)[0]
    size, count = struct.unpack_from('<HH', data, 54)
    alignments = []
    for i in range(count):
        kind, flags, file_offset, virtual, _, file_size, memory_size, alignment = struct.unpack_from('<IIQQQQQQ', data, offset+i*size)
        if kind == 1:
            if alignment < 16384 or (virtual-file_offset) % 16384:
                raise ValueError(f'{name}: PT_LOAD is not 16KB compatible: {alignment}')
            alignments.append(alignment)
    if not alignments:
        raise ValueError(f'{name}: missing PT_LOAD')
    return {'path':name, 'loadAlignments':alignments}


def check(path):
    report=[]
    with zipfile.ZipFile(path) as apk, open(path,'rb') as raw:
        for entry in apk.infolist():
            if entry.filename.endswith('.so'):
                report.append(inspect_elf(entry.filename,apk.read(entry)))
                if entry.filename.startswith('lib/') and entry.compress_type==zipfile.ZIP_STORED:
                    raw.seek(entry.header_offset+26)
                    name_len, extra_len=struct.unpack('<HH',raw.read(4))
                    data_offset=entry.header_offset+30+name_len+extra_len
                    if data_offset % 16384:
                        raise ValueError(f'{entry.filename}: APK data offset is not 16KB aligned')
            elif entry.filename.endswith('.imy'):
                with zipfile.ZipFile(io.BytesIO(apk.read(entry))) as nested:
                    for name in nested.namelist():
                        if name.endswith('.so'):
                            report.append(inspect_elf(entry.filename+'!/'+name,nested.read(name)))
        abis={p.split('/')[1] for p in apk.namelist() if p.startswith('lib/')}
        if abis!={'arm64-v8a','x86_64'}:
            raise ValueError(f'Expected universal arm64-v8a/x86_64 package, found {abis}')
    if not report:raise ValueError('No native libraries checked')
    return {'apk':Path(path).name,'libraries':len(report),'elfPageSize':16384,'checks':report}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('apk');parser.add_argument('--report');args=parser.parse_args()
    result=check(args.apk)
    if args.report:Path(args.report).write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(f"Checked {result['libraries']} native libraries: 16KB ELF/APK alignment OK")
