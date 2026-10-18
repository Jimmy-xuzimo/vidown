# Android reference review

Reviewed on 2026-10-19. Reference: [Seal](https://github.com/JunkFood02/Seal),
commit [`7677f61`](https://github.com/JunkFood02/Seal/tree/7677f61a20fda4210e84215fef9e9b51d25daa47).

Seal is a native Kotlin/Jetpack Compose application with Material Design 3.
Its UI uses composable destinations, tonal surfaces, format-selection screens,
download configuration sheets and public Compose animation APIs. It uses the
Android yt-dlp wrapper `io.github.junkfood02.youtubedl-android`; using a mature
extractor underneath a native UI is compatible with native Android development.

For this revision, Vidown independently implements clearer input and extraction
errors, a video/audio format summary, full-row accessible options, and bounded
navigation motion. Floating navigation stays bottom-centered in portrait and
left-centered in landscape. Animated offsets are read in the layout phase;
screen changes do not animate the entire content's measured size. These changes
reduce unnecessary work but do not establish physical-device frame rates.

Seal is GPLv3. No Seal source, artwork, colors or binaries were copied into
Vidown. Reviewing its interaction and architecture does not change Vidown's
license. Direct reuse of GPL code would require an explicit licensing decision
and preservation of that code's copyright and distribution obligations.
Vidown continues to use its own Gecko session adapter, bundled upstream yt-dlp,
Media3 downloads and source-built FFmpeg libraries. In particular, replacing the
session adapter with another downloader would need to preserve the browser's
authentication context and the project's source-quality checks.

Source references:

- [Seal theme](https://github.com/JunkFood02/Seal/blob/7677f61a20fda4210e84215fef9e9b51d25daa47/app/src/main/java/com/junkfood/seal/ui/theme/Theme.kt)
- [Download configuration](https://github.com/JunkFood02/Seal/blob/7677f61a20fda4210e84215fef9e9b51d25daa47/app/src/main/java/com/junkfood/seal/ui/page/downloadv2/configure/DownloadDialogV2.kt)
- [Format components](https://github.com/JunkFood02/Seal/blob/7677f61a20fda4210e84215fef9e9b51d25daa47/app/src/main/java/com/junkfood/seal/ui/component/FormatItem.kt)
- [License](https://github.com/JunkFood02/Seal/blob/7677f61a20fda4210e84215fef9e9b51d25daa47/LICENSE)
- [Compose performance phases](https://developer.android.com/develop/ui/compose/performance/phases)
- [Compose animation guide](https://developer.android.com/develop/ui/compose/animation/quick-guide)
