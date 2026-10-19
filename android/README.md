# Vidown for Android

Native Android implementation of Vidown. This independent project lives beside the desktop application. It does not embed Electron, Node.js, React or the desktop Windows browser host.

**0.1.0-preview.6 — signed Android preview.** Download the single universal APK from the [Android release](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-v0.1.0-preview.6). The complete migration plan is not yet finished. Premium-account extraction, physical-device background behavior, battery use, thermals and HDR display remain separate release gates. The desktop release number and tags are unchanged. See [acceptance and remaining work](ACCEPTANCE.md) for the exact tested scope.

Preview.6 adds exact-video Douyin webpage discovery, Bilibili film/episode and voice-version selection, and a persistent adaptive navigation bar with native Compose swipe paging. All extraction uses the saved Gecko session. Preview-only playback is labeled explicitly; DRM and account/region restrictions remain enforceable. Public-network results are reported per site and do not establish premium-account support.

## Native interface

The workbench, queue, history and settings use Kotlin, Jetpack Compose and public
Material 3 components. Phones and tablets use a centered floating navigation capsule: bottom-centered
in portrait, left-centered in landscape. Resizing/rotation chooses the layout
from the current window orientation. Its glass styling uses translucent gradients, an edge highlight
and a spring-driven selection lens; it does not capture or continuously blur the screen. Browser resources open in a native modal bottom sheet on phones
and in a side panel when sufficient width is available.

Four palettes include complete light and dark surfaces. Status and navigation bar
icons follow the app's selected mode. Navigation uses AndroidX Compose spring
motion with a short fade; task progress animates between reported values. The
app's motion switch disables these transitions, and Compose follows the system
animation duration scale. No continuous decorative animation runs while idle.

Every new browser tab starts with both Gecko's desktop User-Agent and desktop
viewport. The desktop-site chip switches both settings for that tab and reloads
it; newly created tabs continue to default to desktop mode. Fixed-height tabs,
ellipsis titles and a reserved progress row prevent browser chrome from jumping.
Sites can still choose their own responsive layout.

![Adaptive floating navigation and link-first workbench](verification/preview.4/interface-preview.png)

The link input is the first workbench card. Successful extraction reveals the new
format card automatically; repeated extraction replaces the old result for that
page. Video and audio have separate, labeled selectors showing the formats the
source actually returns. Captured media on supported video pages first re-extracts
the owning page in the same session, rather than treating one CDN file as the
complete quality list. If that extraction fails, the captured-file fallback is
explicitly identified. A muxed source cannot be combined with another audio track.
The app uses its launcher artwork for in-app branding. Settings includes links to
the GitHub repository and project website.

### Media request fix introduced in preview.5

Gecko's native channel setup replaces an ordinary `Referer` header with its
separate referrer setting. Preview.5 uses `WebRequest.Builder.referrer()` so
anti-hotlink checks receive the actual page origin. Cross-origin CDN redirects
preserve Range and only the page origin, while removing Authorization and
private headers. Controlled tests cover a logged-in, referrer-protected CDN,
an unavailable primary, a redirect and byte-for-byte complete cache output.
This fixes an observed transport defect; premium-account acceptance still
requires testing on the affected device.

### Extraction fixes in preview.4

The Gecko request adapter now preserves both yt-dlp's default headers and
request-specific overrides. Previously, losing the desktop User-Agent caused a
mobile-page redirect; generic extraction could then return an HTML embedded
player as if it were media. HTTP downloads now reject HTML responses explicitly.
The prior preview.3 public-sample report was a false positive, not evidence that
the source only supplied one muxed format.

Mobile, BV/AV, embedded-player and short video links are normalized while keeping
the selected `p` value. Shared text surrounding a URL is accepted. Exact backup
CDNs from the upstream play-info response are retained for every available track,
including lower-bitrate audio; a failed primary is switched before caching begins.
No CDN URL or signature is invented or rewritten. Browser login and extractor
requests continue to share the same Gecko session.

The input remains the first card, with an explicit paste action. Parse failures
stay visible with a retry/browser explanation. Format cards summarize the actual
video/audio counts and duration; full-row options have accessible touch targets.
Animations use public Compose APIs, layout-phase offsets and bounded transitions.
[Seal reference review](REFERENCE_REVIEW.md) documents design inspiration and the
GPLv3 boundary; no Seal code or assets were copied.

Design references:

- [Material 3 in Compose](https://developer.android.com/develop/ui/compose/designsystems/material3)
- [Compose animation guide](https://developer.android.com/develop/ui/compose/animation/quick-guide)
- [Adaptive navigation](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation)
- [Default accessibility behavior and touch targets](https://developer.android.com/develop/ui/compose/accessibility/api-defaults)

## Requirements and build

- Android 14 or later (API 34); arm64-v8a and x86_64.
- JDK 17, Gradle 9.6.0 (checked wrapper), AGP 9.4.0, Kotlin 2.4.21.
- Stable Android SDK 37.2, NDK 28.2.13676358, CMake 3.31.6. Target API remains 37. Stable GeckoView 158 requires compile API 37.2, rather than the original plan's 37.0.
- Python 3.12 on the build host only. The APK contains its own Python runtime.
- Linux: make, gcc, pkg-config and CMake. Windows: the equivalent MSYS2 tools plus the Android SDK CMake distribution.

```sh
python tools/prepare-sources.py
export ANDROID_SDK_ROOT=/path/to/android-sdk
bash tools/build-native.sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

On Windows run these commands from the `android` directory with the Gradle wrapper and use MSYS2 Bash for the native build. Set `sdk.dir` in untracked `local.properties`, or configure the SDK environment. Do not commit local SDK paths or signing keys.

`tools/sources.lock.json` pins the source archives and SHA-256 digests for FFmpeg, QuickJS-NG and libxml2. FFmpeg is built as shared LGPL libraries without GPL/nonfree options. The runtime does not download replacement executable components.

Chaquopy 17.1 currently uses AGP's legacy variant API. The two compatibility flags in `gradle.properties` are intentional, produce deprecation warnings, and must be removed when Chaquopy supports the new API. Do not upgrade AGP to 10 without that migration.

## Architecture

- Kotlin, Compose and Material 3 render the application interface. GeckoView is initialized only when a browser or network operation needs it; Python and native libraries also initialize on demand.
- Room persists tasks and ordered state changes. DataStore persists settings. Private browser profiles retain persistent site data; Keystore encryption protects the optional seven-day session-cookie recovery snapshot and private plans.
- A bundled WebExtension discovers requests in actual browsing sessions. The extractor and Media3 downloaders use Gecko's network executor. Credentials are referenced privately; media URLs and request headers are absent from UI models and diagnostic exports.
- Media3 caches selected resources. The private native media process reads only registered cached resources, remuxes using FFmpeg and validates the output before MediaStore/SAF publication. It has no fallback network transport.
- UIDT jobs run user-started downloads. WorkManager schedules postprocessing with the applicable foreground service type. Pauses/cancellation stop actual transfers. After process restart, unfinished records become interrupted and require fresh extraction.

## Controlled verification

From the repository root, start the fixture server:

```sh
python android/tools/fixtures.py --ffmpeg resources/tools/ffmpeg.exe
```

The host binds `127.0.0.1:18763`; the emulator uses `10.0.2.2:18763`. Generated test media stays in ignored `work/android-fixtures`. The samples use synthetic test patterns and tones. They do not contain account credentials or third-party videos.

Build both debug APKs, then run on a dedicated Android emulator:

```sh
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
cd ..
python android/tools/run-device-tests.py --serial emulator-5554
```

The runner performs a separate startup-isolation test before loading any engine, then runs the controlled suite. Public network checks are opt-in with `--public-network`; real-account tests are manual. API 37 emulators need local-network permission for the host fixture. The runner grants this only on the explicitly selected test emulator. Production internet access does not require local-network permission.

For the actual signed, shrunk release APK, use external UI automation instead of injecting instrumentation dependencies into its shrinker graph:

```sh
python android/tools/check-release-ui.py --serial emulator-5554 \
  --ffprobe /path/to/ffprobe --install --fresh --output work/android-release-test
```

`--fresh` clears application data only on a dedicated `Vidown_` emulator or CI. This test downloads synthetic HLS media, signs into the local fixture in Gecko, restarts the app, extracts a protected webpage through bundled Python, publishes files and checks them using the host ffprobe.

Device tests exercise the packaged JNI engine and real downloaded media, not a fake completion result. Keep generated reports and emulator evidence separate from claims about real websites. Tests that require accounts must be performed manually in the application and never export credentials.

CI selects the pinned SDK tools for `android-emulator-runner` and checks each
AVD's recorded target before boot. The hosted runner's older `avdmanager` can
silently write `android-0` for dotted API levels, leading to system graphics
crash loops ([upstream report](https://github.com/actions/runner-images/issues/14484)).
`tools/ci-sdk.py` only operates in disposable CI environments; it does not
change a developer's local SDK or skip application assertions.

The blob-save fixture intentionally prepares its file asynchronously. Its test
waits for the DOM-ready title and an actual Gecko compositor frame, performs a
system-coordinate touch on the native view, waits for save acknowledgement and
compares complete output bytes with the source. Compose idleness does not wait
for the separate Gecko compositor; response headers alone do not establish blob
readiness. Subsequent failures and
fix verification are recorded separately from the immutable preview evidence in
[acceptance](ACCEPTANCE.md#subsequent-ci-regression-blob-readiness).

Chinese installation and usage instructions are available in the
[Android guide](../docs/ANDROID.md). Published desktop and Android changes are
listed separately in the [changelog](../docs/CHANGELOG.md).

## Distribution boundaries

The initial GitHub deliverable is one universal signed APK. AAB generation is for a later, separate Play evaluation. Keep Android tags independent (`android-v…`). A stable release requires physical-device acceptance. There is no promise that the GitHub feature set can be published unchanged on Google Play.

Release signing reads `VIDOWN_KEYSTORE`, `VIDOWN_STORE_PASSWORD`, `VIDOWN_KEY_ALIAS` and `VIDOWN_KEY_PASSWORD` from the build environment. Without these, a release build is unsigned. Back up the signing key securely; it is needed to update an installed APK. Never commit the key or its passwords. GitHub Actions accepts the corresponding `ANDROID_*` secrets; a manually requested signed package is built only after unit, Lint and emulator jobs pass, then installed and checked on a separate release emulator. The APK for this preview was signed and checked locally; GitHub build/emulator results are linked separately in the [verification inventory](verification/index.json). Signing secrets have not been uploaded.

`tools/check-native.py` inspects every ELF, including nested Python archives, and APK library alignment. Also run the official `zipalign -c -P 16 4` and `apksigner verify` tools before distribution. `tools/package-materials.py` produces the matching source/build-materials archive without local SDK paths, signing keys or build caches. Keep the AAB, hashes and reports separate from the single user-facing APK.

No external-browser Cookie import, TDLib integration, live recording, playlist/channel crawling, DRM bypass, cloud account, advertisements or analytics are added. Embedded login may be blocked by a website; external-browser cookies cannot automatically return to this app. Compatibility export does not silently convert HDR or Dolby Vision to SDR.

See [privacy policy](PRIVACY.md) and the bundled component notices. Application source is MIT; third-party licenses continue to apply independently.
