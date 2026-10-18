# Android distribution materials

Vidown application code is MIT. The APK is a collection of components with their
own licenses; the installer as a whole is not licensed solely under MIT.

| Component                           | License / source                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| FFmpeg                              | LGPL-2.1-or-later; exact archive/hash in `tools/sources.lock.json`                                                   |
| QuickJS-NG                          | MIT; exact archive/hash in `tools/sources.lock.json`                                                                 |
| libxml2                             | MIT; exact archive/hash in `tools/sources.lock.json`                                                                 |
| GeckoView 158.0.20261007201254      | MPL-2.0 and third-party exceptions; [Mozilla source](https://archive.mozilla.org/pub/firefox/releases/158.0/source/) |
| Chaquopy 17.1.0                     | MIT; [source and build tools](https://github.com/chaquo/chaquopy/tree/17.1.0)                                        |
| CPython 3.12.15                     | PSF and bundled exceptions; [source](https://www.python.org/downloads/release/python-31215/)                         |
| yt-dlp 2026.8.19 / yt-dlp-ejs 0.8.0 | Unlicense and component notices; wheel hashes in `app/requirements.lock.txt`                                         |
| AndroidX, Kotlin and kotlinx        | Apache-2.0 and retained notices; resolved artifacts in `app/gradle.lockfile` and `gradle/verification-metadata.xml`  |

The APK retains Mozilla's full third-party notice in Gecko's `omni.ja`. The app's
Settings screen also exposes the collected runtime notices, including Python,
extractor and JavaScript solver notices. `app/src/main/assets/components.json`
records resolved runtime artifact hashes; it is not a security certification.

FFmpeg is dynamically linked. Its build disables GPL, nonfree, external codec
autodetection and network protocols. Android MediaCodec performs optional lossy
compatibility export. Native FFmpeg reads downloaded, task-registered resources
through cache callbacks; it does not have a second HTTP client.

`tools/prepare-sources.py` contains the only source patches: HLS and DASH recognize
HTTP(S)/crypto+HTTP names while cache callbacks perform the actual reads. The
original source archives, patch script, configuration, Android/JNI source and
license texts are included by `tools/package-materials.py`. Run it after preparing
sources, and distribute the resulting materials beside the matching APK on the
project's materials page. Rebuilding/replacing the LGPL libraries and re-signing
the APK is permitted; Android may require uninstalling a differently signed app
first. Back up exported files before doing so.

Generate notices after a dependency update with `python tools/collect-notices.py`
(after a debug build). Review the resulting files. Do not treat a cached previous
notice list as evidence that a newly added dependency has been reviewed.

Before public release, verify that exact corresponding source remains available
for every distributed native component, provide the matching materials link, and
retain this document and the original notices. No patent license or legal review
is implied by these build checks.
