#!/usr/bin/env bash
set -euo pipefail
root="$1"
arch="${2:-x64}"
case "$arch" in
  x64)
    apple_arch=x86_64
    ffmpeg_arch=x86_64
    cpu=x86-64
    cpu_flags="-march=x86-64 -mtune=generic"
    vpx_target=x86_64-darwin24-gcc
    ;;
  arm64)
    apple_arch=arm64
    ffmpeg_arch=aarch64
    cpu=generic
    cpu_flags="-march=armv8-a"
    # libvpx treats bare arm*-darwin-* as iOS; Darwin 24 selects macOS 15.
    vpx_target=arm64-darwin24-gcc
    ;;
  *) echo "Unsupported Darwin architecture: $arch" >&2; exit 1 ;;
esac
target="darwin-$arch"
work="$root/build/ffmpeg/work/$target"
src="$work/sources"
prefix="$root/build/ffmpeg/install/$target"
jobs="${MOARTUBE_BUILD_JOBS:-4}"
export MACOSX_DEPLOYMENT_TARGET=15.0
export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
export CC=clang CXX=clang++ AR=ar RANLIB=ranlib
export CFLAGS="-O2 -fPIC -arch $apple_arch $cpu_flags -mmacosx-version-min=15.0"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-arch $apple_arch -mmacosx-version-min=15.0"
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
unset PKG_CONFIG_PATH CPATH LIBRARY_PATH DYLD_LIBRARY_PATH
mkdir -p "$prefix" "$work/objects"
cd "$src/x264"
./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli --disable-opencl
make -j"$jobs"
make install
cd "$src/libvpx"
./configure --prefix="$prefix" --target="$vpx_target" --enable-pic --enable-static --disable-shared --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp9-highbitdepth
make -j"$jobs"
make install
cmake -S "$src/opus" -B "$work/objects/opus" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_OSX_ARCHITECTURES="$apple_arch" -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF
cmake --build "$work/objects/opus" --parallel "$jobs"
cmake --install "$work/objects/opus"
meson setup "$work/objects/dav1d" "$src/dav1d" --prefix="$prefix" --libdir=lib --default-library=static --buildtype=release -Db_staticpic=true -Denable_tools=false -Denable_tests=false -Denable_examples=false -Denable_docs=false
meson compile -C "$work/objects/dav1d" -j "$jobs"
meson install -C "$work/objects/dav1d"
cd "$src/zlib"
./configure --prefix="$prefix" --static
make -j"$jobs"
make install
mkdir -p "$work/objects/ffmpeg"
cd "$work/objects/ffmpeg"
bash "$src/ffmpeg/configure" \
  --prefix="$prefix" --target-os=darwin --arch="$ffmpeg_arch" --cpu="$cpu" \
  --cc=clang --cxx=clang++ --enable-gpl --disable-nonfree --disable-autodetect \
  --enable-static --disable-shared --disable-ffplay --disable-doc --disable-debug \
  --enable-libx264 --enable-libvpx --enable-libopus --enable-libdav1d --enable-zlib \
  --enable-videotoolbox --enable-audiotoolbox --enable-securetransport \
  --enable-filter=scale_vt \
  --extra-cflags="-I$prefix/include $CFLAGS" \
  --extra-ldflags="-L$prefix/lib $LDFLAGS" \
  --extra-version="moartube-$target-r1"
make -j"$jobs"
make install
cp ffbuild/config.log "$root/build/ffmpeg/reports/$target/config.log"
cp config.h "$root/build/ffmpeg/reports/$target/config.h"
