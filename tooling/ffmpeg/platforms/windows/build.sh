#!/usr/bin/env bash
set -euo pipefail
root="$1"
work="$root/build/ffmpeg/work/win32-x64"
src="$work/sources"
prefix="$root/build/ffmpeg/install/win32-x64"
jobs="${MOARTUBE_BUILD_JOBS:-8}"
export CC=clang CXX=clang++ AR=llvm-ar RANLIB=llvm-ranlib
export CFLAGS='-O2 -march=x86-64 -mtune=generic'
export CXXFLAGS="$CFLAGS"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
mkdir -p "$prefix" "$work/objects" "$root/build/ffmpeg/reports/win32-x64"
clang --version > "$root/build/ffmpeg/reports/win32-x64/compiler.txt"

# Dependencies build into an isolated prefix. No binaries from an existing
# system FFmpeg installation or third-party FFmpeg distribution are consumed.
cd "$src/x264"
./configure --prefix="$prefix" --host=x86_64-w64-mingw32 --enable-static --disable-cli --disable-opencl
make -j"$jobs"
make install

cd "$src/libvpx"
./configure --prefix="$prefix" --target=x86_64-win64-gcc --enable-static --disable-shared --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp9-highbitdepth
make -j"$jobs"
make install

cmake -S "$src/opus" -B "$work/objects/opus" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$(cygpath -m "$prefix")" -DBUILD_SHARED_LIBS=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF
cmake --build "$work/objects/opus" --parallel "$jobs"
cmake --install "$work/objects/opus"

meson setup "$work/objects/dav1d" "$src/dav1d" --prefix="$(cygpath -m "$prefix")" --libdir=lib --default-library=static --buildtype=release -Denable_tools=false -Denable_tests=false -Denable_examples=false -Denable_docs=false --reconfigure
meson compile -C "$work/objects/dav1d" -j "$jobs"
meson install -C "$work/objects/dav1d"

# Install only the static target; upstream's full install also includes a DLL.
cmake -S "$src/zlib" -B "$work/objects/zlib" -G Ninja -DCMAKE_BUILD_TYPE=Release -DZLIB_BUILD_EXAMPLES=OFF
cmake --build "$work/objects/zlib" --target zlibstatic --parallel "$jobs"
cp "$work/objects/zlib/libzlibstatic.a" "$prefix/lib/libz.a"
cp "$src/zlib/zlib.h" "$work/objects/zlib/zconf.h" "$prefix/include/"

cmake -S "$src/libvpl" -B "$work/objects/libvpl" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$(cygpath -m "$prefix")" -DBUILD_SHARED_LIBS=OFF -DBUILD_TOOLS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTS=OFF -DBUILD_DISPATCHER_ONEVPL_EXPERIMENTAL=OFF -DINSTALL_EXAMPLE_CODE=OFF
cmake --build "$work/objects/libvpl" --parallel "$jobs"
cmake --install "$work/objects/libvpl"

make -C "$src/nv-codec-headers" PREFIX="$prefix" install
mkdir -p "$prefix/include/AMF"
cp -R "$src/amf/amf/public/include/." "$prefix/include/AMF/"

mkdir -p "$work/objects/ffmpeg"
cd "$work/objects/ffmpeg"
# schannel uses Windows TLS and its certificate store; no OpenSSL runtime.
# CUDA LLVM compiles bundled kernels without the CUDA toolkit or nonfree libnpp.
bash "$src/ffmpeg/configure" \
  --prefix="$prefix" --target-os=mingw32 --arch=x86_64 --cpu=x86-64 \
  --cc=clang --cxx=clang++ --ld=clang++ --ar=llvm-ar --ranlib=llvm-ranlib --nm=llvm-nm \
  --enable-gpl --disable-nonfree --disable-autodetect \
  --enable-static --disable-shared --disable-ffplay --disable-doc --disable-debug --disable-filter=gfxcapture \
  --enable-libx264 --enable-libvpx --enable-libopus --enable-libvpl --enable-libdav1d --enable-zlib \
  --enable-amf --enable-d3d11va --enable-dxva2 --enable-ffnvcodec \
  --enable-cuda-llvm --nvccflags='--cuda-gpu-arch=sm_52 -O2' --enable-cuvid --enable-nvdec --enable-nvenc --enable-schannel \
  --enable-filter=scale_cuda --enable-filter=vpp_amf --enable-filter=vpp_qsv \
  --pkg-config-flags=--static \
  --extra-cflags="-I$prefix/include -O2 -march=x86-64 -mtune=generic" \
  --extra-ldflags="-L$prefix/lib -static" \
  --extra-version=moartube-win32-x64-r1
make -j"$jobs"
make install
cp ffbuild/config.log "$root/build/ffmpeg/reports/win32-x64/config.log"
cp config.h "$root/build/ffmpeg/reports/win32-x64/config.h"
