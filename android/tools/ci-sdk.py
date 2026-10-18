#!/usr/bin/env python3
"""Select the pinned CI SDK tools and reject incorrectly generated AVD metadata."""
import argparse
import os
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-avd')
    parser.add_argument('--api')
    args = parser.parse_args()
    if not os.environ.get('CI'):
        parser.error('This helper only changes disposable CI SDK installations')
    if args.check_avd:
        if not args.api:
            parser.error('--api is required with --check-avd')
        base = Path(os.environ['ANDROID_AVD_HOME']).resolve()
        target = base / (args.check_avd + '.ini')
        if target.parent != base:
            raise RuntimeError('Invalid AVD name')
        fields = dict(line.split('=', 1) for line in target.read_text().splitlines() if '=' in line)
        if fields.get('target') != 'android-' + args.api:
            raise RuntimeError('SDK tools generated an incorrect AVD target: ' + fields.get('target', 'missing'))
        print('Verified AVD target:', fields['target'])
        return
    base = Path(os.environ['ANDROID_HOME']).resolve() / 'cmdline-tools'
    pinned = base / '15859902'
    if not (pinned / 'bin/avdmanager').is_file():
        raise RuntimeError('Pinned SDK tools were not installed')
    latest = base / 'latest'
    if latest.resolve() != pinned.resolve():
        backup = Path(os.environ['RUNNER_TEMP']).resolve() / 'vidown-preinstalled-cmdline-tools'
        if backup.exists():
            raise RuntimeError('Refusing to overwrite SDK backup')
        if latest.exists() or latest.is_symlink():
            shutil.move(str(latest), str(backup))
        latest.symlink_to(pinned, target_is_directory=True)
    print('Emulator runner SDK tools:', latest.resolve())


if __name__ == '__main__':
    main()
