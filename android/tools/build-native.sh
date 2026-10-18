#!/usr/bin/env bash
# LGPL FFmpeg shared libraries, no GPL/nonfree codecs. Run from MSYS2 or Linux.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT}"
case "$(uname -s)" in
 MSYS*|MINGW*) HOST=windows-x86_64; EXE=.exe; ANDROID_SDK_ROOT="$(cygpath -m "$ANDROID_SDK_ROOT")" ;;
 Linux*) HOST=linux-x86_64; EXE= ;;
 Darwin*) HOST=darwin-x86_64; EXE= ;;
 *) echo 'Unsupported build host' >&2;exit 1 ;;
esac
NDK="$ANDROID_SDK_ROOT/ndk/28.2.13676358"
BIN="$NDK/toolchains/llvm/prebuilt/$HOST/bin"
SYSROOT="$NDK/toolchains/llvm/prebuilt/$HOST/sysroot"
CMAKE="${VIDOWN_CMAKE:-$ANDROID_SDK_ROOT/cmake/3.31.6/bin/cmake$EXE}"
JOBS="${VIDOWN_BUILD_JOBS:-6}"
FINGERPRINT="$(cat "$ROOT/tools/sources.lock.json" "$ROOT/tools/build-native.sh" "$ROOT/tools/prepare-sources.py" "$ROOT/third-party/ffmpeg/libavformat/hls.c" "$ROOT/third-party/ffmpeg/libavformat/dashdec.c" | sha256sum | cut -d' ' -f1)"
for ABI in "${@:-arm64-v8a x86_64}"; do
 # A default argument is expanded below; explicit ABI arguments work individually.
 for ARCH_ABI in $ABI; do
  case "$ARCH_ABI" in arm64-v8a) ARCH=aarch64;TARGET=aarch64-linux-android34;;x86_64)ARCH=x86_64;TARGET=x86_64-linux-android34;;*)exit 2;;esac
  PREFIX="$ROOT/native-build/prefix/$ARCH_ABI"
  BUILD="$ROOT/native-build/$ARCH_ABI"
  mkdir -p "$PREFIX" "$BUILD"
  if [ -f "$PREFIX/lib/libavformat.so" ] && [ -f "$PREFIX/build.sha256" ] && [ "$(cat "$PREFIX/build.sha256")" = "$FINGERPRINT" ]; then echo "$ARCH_ABI already built from current source/configuration";continue;fi
  "$CMAKE" -S "$ROOT/third-party/libxml2" -B "$BUILD/xml" -G Ninja \
   -DCMAKE_MAKE_PROGRAM="$ANDROID_SDK_ROOT/cmake/3.31.6/bin/ninja$EXE" \
   -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
   -DANDROID_ABI="$ARCH_ABI" -DANDROID_PLATFORM=android-34 \
   -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
   -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_SHARED_LIBS=OFF \
   -DLIBXML2_WITH_PROGRAMS=OFF -DLIBXML2_WITH_TESTS=OFF -DLIBXML2_WITH_ICONV=OFF \
   -DLIBXML2_WITH_MODULES=OFF -DLIBXML2_WITH_ZLIB=OFF -DLIBXML2_WITH_LZMA=OFF \
   -DLIBXML2_WITH_PYTHON=OFF -DLIBXML2_WITH_DOCS=OFF
  "$CMAKE" --build "$BUILD/xml" --parallel "$JOBS"
  "$CMAKE" --install "$BUILD/xml"
  mkdir -p "$BUILD/ffmpeg";cd "$BUILD/ffmpeg"
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
  "$ROOT/third-party/ffmpeg/configure" --prefix="$PREFIX" \
   --target-os=android --arch="$ARCH" --enable-cross-compile \
   --cc="$BIN/clang$EXE --target=$TARGET --sysroot=$SYSROOT" \
   --cxx="$BIN/clang++$EXE --target=$TARGET --sysroot=$SYSROOT" \
   --ar="$BIN/llvm-ar$EXE" --ranlib="$BIN/llvm-ranlib$EXE" --strip="$BIN/llvm-strip$EXE" \
   --disable-autodetect --disable-everything --disable-programs --disable-doc --disable-debug --disable-avdevice --disable-avfilter --disable-swscale \
   --disable-asm --enable-shared --disable-static --enable-pic --enable-small --enable-libxml2 \
   --enable-avformat --enable-avcodec --enable-avutil --enable-swresample \
   --enable-protocol=file,pipe,crypto \
   --enable-demuxer=hls,dash,mov,matroska,mpegts,aac,flac,mp3,ogg,wav,ac3,eac3 \
   --enable-muxer=mp4,matroska,flac,adts,mp3,ogg,wav \
   --enable-parser=aac,h264,hevc,av1,vp9,opus,flac,mpegaudio,ac3 \
   --enable-decoder=h264,hevc,vp9,aac,flac,opus,vorbis,mp3,ac3,eac3 \
   --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata \
   --pkg-config-flags=--static --extra-ldflags="-Wl,-z,max-page-size=16384" \
   --extra-cflags="-fPIC -O2 -I$PREFIX/include"
  make -j"$JOBS"
  make install
  echo "$FINGERPRINT" > "$PREFIX/build.sha256"
  echo "Built $ARCH_ABI from locked LGPL source"
 done
done
