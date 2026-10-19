# Android preview acceptance

Version: **0.1.0-preview.4**. Reviewed on **19 October 2026**. This is a
signed Android preview, not a stable release or Google Play approval. Desktop
remains on its independent release track. Raw local logs retain their host dates.

## What changed

The previous public Bilibili check was a false positive: missing extractor
default headers caused mobile redirection and generic extraction of an HTML
embedded player. Preview.4 preserves the desktop request context, normalizes
BV/AV/mobile/embedded/short links, retains upstream backup CDNs for each track,
and rejects HTML media responses. Historical preview.3 reports remain available
but their single-muxed-format result must not be used as evidence of support.

The link card stays first, accepts shared text and provides an explicit paste
action. Extraction errors stay visible. Format cards show actual video/audio
counts and separate selectors with full-row touch targets. Navigation is centered
at the bottom in portrait and on the left in landscape. Public Compose
spring/fade APIs provide bounded motion, with animated offsets read during layout
and no whole-page size animation. Motion can be disabled. See the
[Seal reference review](REFERENCE_REVIEW.md); no Seal source or assets were copied.

## Current evidence

### Subsequent CI regression: blob readiness

The earlier passing matrix below remains a historical result. A subsequent main
run, [39157748209](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39157748209),
failed the blob-save test on the API 37.2 16 KB tablet; the other eight device jobs
passed. This was an application-test timeout, not the previous SDK provisioning
failure. The test clicked after response headers and a fixed one-second delay,
which does not establish that asynchronous preparation enabled the button. The
original CI did not record the DOM state at the instant of the click.

A three-second fixture preparation delay reproduces the same failure with the
old test. A readiness-only correction passed locally but the subsequent hosted
run [39187745887](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39187745887)
still missed the real click on API 37 tablets; the new acknowledgement localized
the failure before file saving. That run also had an independent API 35 tablet
SDK ZIP download failure before any application test ran.

The final correction waits for explicit DOM readiness and the actual Gecko
compositor frame, injects a touch using the native view's screen coordinates,
acknowledges the real save and compares complete output bytes with the source.
It captures a pre-touch frame and a failure screenshot for future diagnosis.
It does not increase the transfer timeout or retry failed tests. Local results
and the final hosted run are recorded in the [regression record](verification/regressions/2026-10-19-blob-save.json).
Application runtime source and the published signed preview APK are unchanged;
no reinstall or tag movement is needed.

The [final hosted run](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39188787785)
passed all nine configurations: 38 controlled tests and a separate startup check
each. Lint has zero errors and 28 retained warnings; all 178 native ELF objects
pass alignment checks. The API 34 tablet initially encountered an unrelated
[Pixel Launcher ANR overlay](verification/regressions/launcher-anr-before-tap.png).
Android correctly rejected injection into the system-owned window. Only that
job was rerun after checking the screenshot and InputDispatcher logs, then passed;
the other eight were not rerun. The complete record retains this infrastructure
failure alongside the successful second attempt.

### Published preview evidence

Summaries and selected screenshots are in [verification/preview.4](verification/preview.4/).
[The inventory](verification/index.json) ties the exact APK to its size and SHA-256.
Full transient logs and media stay outside the source distribution.

| Check                    | Result and scope                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                    | Signed R8 release APK and AAB; debug/test APKs; 4 JVM tests passed                                                                                                                                                          |
| Lint                     | Debug and release: zero errors, 28 warnings each; warnings remain in generated reports                                                                                                                                      |
| Controlled devices       | API 34 phone and API 37.2 tablet with actual 16 KB pages: 38 checks plus a separate startup-isolation check per device                                                                                                      |
| GitHub hosted matrix     | Nine configurations passed: API 34/35/36/37.0 phone and tablet, plus API 37.2 tablet with 16 KB pages. Each ran 38 controlled checks and a separate startup-isolation check; debug packages, no live accounts               |
| Portrait/font            | Phone portrait, tablet portrait and phone at 200% font: 10 UI checks per configuration                                                                                                                                      |
| Public links             | Six Bilibili URL forms parsed through production extraction; selected video and audio each returned 65,536 bytes of media with HTTP 206, not HTML                                                                           |
| Signed release           | Installed independently of instrumentation on phone and tablet; separate-track HLS, browser login, force-stop/restart, authenticated extraction, native remux and MediaStore publication; pulled files checked with ffprobe |
| Public complete download | Signed release on tablet downloaded the supplied public sample without an account: 1920×1080 HEVC + AAC, 218.560 seconds, 42,252,459 bytes; output compared with selected format                                            |
| Native package           | All 178 ELF objects, including nested Python libraries, pass 16 KB alignment; official apksigner and zipalign checks pass; bundletool validates AAB                                                                         |
| Website                  | 390/768/1440 px, English/Chinese and light/dark: 12 combinations, no horizontal overflow; Android download target checked                                                                                                   |

The supplied sample exposed 12 video and 3 independent audio formats without
sign-in. Availability is account-, source- and time-dependent; this does not
establish premium 4K/8K, Dolby Vision, HDR or Hi-Res access. Synthetic play-info
tests separately exercise distinct AVC/HDR10/Dolby Vision and AAC/FLAC/E-AC-3
selection through the packaged extractor and Kotlin decoder. Synthetic HDR10
and 96 kHz/24-bit FLAC fixtures exercise metadata and encoded-packet preservation.
Neither synthetic result substitutes for authenticated platform acceptance.

Controlled media cases cover HTTP, HLS TS/fMP4/byte ranges/AES-128/key rotation/
discontinuities/independent audio, separated DASH, audio-only output, native
validation and optional system-codec export. They also cover pause/cancel,
same-source segment reuse, ETag changes, 403/429 errors, registered backup CDN,
cross-origin credential stripping, malicious XML, browser blob saving, session
cleanup invalidation and share input. Browser default desktop UA/viewport,
fixed-height tabs, eight palette/mode combinations and navigation touch targets
are checked. The startup assertion verifies that the first workbench does not
initialize Gecko, Python or native media engines.

Screenshots were visually inspected. The lightweight glass capsule uses
translucent surfaces and edge highlights; it does not capture or continuously
blur the screen. No idle decorative animation runs. Emulator responsiveness
does not establish physical-device frame rates, battery use or thermals.

[Release motion observation](verification/preview.4/motion-observation.json):
25 warm navigation taps across the five screens on the API 34 emulator recorded
1,045 frames, 13 marked janky by Android gfxinfo, with 95th/99th percentiles of
27/32 ms. This includes emulator scheduling/GPU behavior and is not a universal
60 FPS claim or a comparison with an older build.

## Implemented scope and remaining gates

| Area              | Current behavior                                                                                                                                                           | Remaining boundary                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Native foundation | Kotlin/Compose/Material 3, Room, DataStore, lazy engines, adaptive layouts                                                                                                 | Full fold posture, TalkBack, process/lifecycle stress and physical-device acceptance                                          |
| Browser/session   | GeckoView, tabs, desktop mode, request discovery, shared transport, private persistent profile, encrypted temporary-cookie recovery, generation invalidation after cleanup | Complex Worker/cache/pop-up sites and real platform accounts need more cases; embedded login restrictions apply               |
| Extraction        | Bundled Python, locked yt-dlp, restricted QuickJS solver, browser-assisted discovery                                                                                       | Bilibili premium, X, YouTube and Telegram authenticated Android acceptance remain open                                        |
| Protocol/media    | Media3 caching, source-built LGPL FFmpeg, separate tracks, source-codec remux, validation before publication                                                               | Multi-Period DASH rejected pending validation; real Dolby Vision RPU/8K unverified; unsafe HDR conversion rejected            |
| Worker            | Private media process, registered cache input, bounded Binder blocks and checked private paths                                                                             | Planned end-to-end descriptor transport is not complete                                                                       |
| Queue/recovery    | UIDT, notifications, concurrency, pause/cancel, same-session checkpoints, WorkManager postprocessing                                                                       | Restart marks unfinished tasks interrupted and requires fresh extraction; vendor power limits and long-run stress remain open |
| Files/history     | MediaStore, optional SAF directory, search/delete/clear and optional file deletion                                                                                         | Full >4 GB, disk-full, revoked-provider and delete-failure matrix remains open                                                |
| Settings          | Four palettes, system/light/dark, motion switch, proxy, rate limits, unmetered-only, foreground opt-in clipboard, cleanup, diagnostics and notices                         | No promise of every proxy/provider; no external-browser Cookie import                                                         |
| Distribution      | One universal APK, arm64-v8a + x86_64, separate materials                                                                                                                  | Runtime testing is x86_64 emulators; arm64 hardware and stable/Play gates remain open                                         |

GitHub CI status is recorded separately in the verification inventory. The
manual signed-package job requires signing secrets and is not implied by a
successful unsigned CI build. Signing keys remain outside Git.

[The passing GitHub run](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39156793676)
builds from a clean Linux host with strict dependency verification. Reports are
in [github-ci.json](verification/preview.4/github-ci.json). Its signed-package job
was not requested; the distributed signed release was checked locally as above.
The Linux-built debug APK was also installed on the local API 37.2/16 KB emulator,
where all 38 checks plus startup isolation passed; see the separate
[cross-host report](verification/preview.4/linux-apk37-cross-host.json).

## Reproduction

See [README](README.md) for the locked toolchain and controlled test commands.
`BilibiliNetworkIntegrationTest` requires explicit `-e publicBilibili true`;
`tools/check-release-ui.py --public-bilibili` opts into the public complete
download. Neither is part of the default synthetic suite. Never commit account
cookies, signed media URLs, private messages or downloaded third-party videos.

Official references: [UIDT](https://developer.android.com/develop/background-work/background-tasks/uidt),
[adaptive layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive),
[16 KB pages](https://developer.android.com/guide/practices/page-sizes),
[Gecko extensions](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html),
[OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies),
[Play target API](https://support.google.com/googleplay/android-developer/answer/11926878).
Recheck store policies before submission; build/test success is not policy approval.
