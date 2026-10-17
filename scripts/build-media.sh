#!/usr/bin/env bash
# Native, static FFmpeg + x264. No prebuilt codec libraries enter public packages.
set -euo pipefail
ROOT="$(pwd)"
PREFIX="$ROOT/work/media-prefix"
SOURCES="$ROOT/work/corresponding-source"
BUILD="$ROOT/work/media-build"
FFMPEG_REV=946fcce07b6dcd0331c8cc609192aeff5e1924f8
X264_REV=c24e06c2e184345ceb33eb20a15d1024d9fd3497
mkdir -p "$PREFIX" "$SOURCES" "$BUILD" "$ROOT/resources/tools/licenses"
fetch_source() {
  local name="$1" repo="$2" rev="$3"
  curl --fail --location --retry 3 --output "$SOURCES/$name-$rev.tar.gz" "https://codeload.github.com/$repo/tar.gz/$rev"
  mkdir -p "$BUILD/$name"
  tar -xf "$SOURCES/$name-$rev.tar.gz" --strip-components=1 -C "$BUILD/$name"
}
fetch_source ffmpeg FFmpeg/FFmpeg "$FFMPEG_REV"
fetch_source x264 mirror/x264 "$X264_REV"
JOBS="${VIDOWN_BUILD_JOBS:-4}"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
cd "$BUILD/x264"
./configure --prefix="$PREFIX" --enable-static --disable-cli --disable-opencl
make -j"$JOBS"
make install
cd "$BUILD/ffmpeg"
EXTRA_LDFLAGS="-L$PREFIX/lib"
EXTRA=()
case "$(uname -s)" in
  MINGW*|MSYS*) EXTRA_LDFLAGS="$EXTRA_LDFLAGS -static"; EXTRA+=(--target-os=mingw32 --enable-schannel) ;;
  Darwin*) EXTRA+=(--enable-securetransport) ;;
esac
./configure --prefix="$PREFIX" --disable-autodetect --disable-shared --enable-static \
  --enable-gpl --enable-libx264 --disable-doc --disable-debug --disable-ffplay \
  --pkg-config-flags=--static --extra-cflags="-I$PREFIX/include" \
  --extra-ldflags="$EXTRA_LDFLAGS" "${EXTRA[@]}"
make -j"$JOBS"
make install
cp "$PREFIX/bin/ffmpeg"* "$PREFIX/bin/ffprobe"* "$ROOT/resources/tools/"
cp COPYING.GPLv3 "$ROOT/resources/tools/licenses/FFmpeg-GPL-3.0.txt"
cp "$BUILD/x264/COPYING" "$ROOT/resources/tools/licenses/x264-GPL-2.0.txt"
cp config.h config_components.h ffbuild/config.mak config.log "$SOURCES/"
cp "$ROOT/scripts/build-media.sh" "$SOURCES/"
printf '%s\n' "$FFMPEG_REV" > "$SOURCES/ffmpeg-revision.txt"
printf '%s\n' "$X264_REV" > "$SOURCES/x264-revision.txt"
"$ROOT/resources/tools/ffmpeg" -version
"$ROOT/resources/tools/ffprobe" -version
