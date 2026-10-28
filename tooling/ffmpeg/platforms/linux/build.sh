#!/usr/bin/env bash
set -euo pipefail
root="$1"
arch="${MOARTUBE_FFMPEG_ARCH:-$(node -p process.arch)}"
case "$arch" in
  x64) ff_arch=x86_64; ff_cpu=x86-64; cpu_flags="-march=x86-64 -mtune=generic"; vpx_target=x86_64-linux-gcc ;;
  arm64) ff_arch=aarch64; ff_cpu=generic; cpu_flags="-march=armv8-a"; vpx_target=arm64-linux-gcc ;;
  *) echo "Unsupported Linux architecture: $arch" >&2; exit 1 ;;
esac
target="linux-$arch"
work="$root/build/ffmpeg/work/$target"
src="$work/sources"
prefix="$root/build/ffmpeg/install/$target"
jobs="${MOARTUBE_BUILD_JOBS:-8}"
export CC=clang CXX=clang++ AR=llvm-ar RANLIB=llvm-ranlib
export CFLAGS="-O2 -fPIC $cpu_flags"
export CXXFLAGS="$CFLAGS"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
mkdir -p "$prefix" "$work/objects" "$root/build/ffmpeg/reports/$target"
clang --version > "$root/build/ffmpeg/reports/$target/compiler.txt"
cp /toolchain-packages.txt "$root/build/ffmpeg/reports/$target/toolchain-packages.txt"
cd "$src/x264"
./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli --disable-opencl
make -j"$jobs"
make install
cd "$src/libvpx"
./configure --prefix="$prefix" --target="$vpx_target" --enable-pic --enable-static --disable-shared --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp9-highbitdepth
make -j"$jobs"
make install
cmake -S "$src/opus" -B "$work/objects/opus" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF
cmake --build "$work/objects/opus" --parallel "$jobs"
cmake --install "$work/objects/opus"
meson setup "$work/objects/dav1d" "$src/dav1d" --prefix="$prefix" --libdir=lib --default-library=static --buildtype=release -Db_staticpic=true -Denable_tools=false -Denable_tests=false -Denable_examples=false -Denable_docs=false --reconfigure
meson compile -C "$work/objects/dav1d" -j "$jobs"
meson install -C "$work/objects/dav1d"
cd "$src/zlib"
./configure --prefix="$prefix" --static
make -j"$jobs"
make install
make -C "$src/nv-codec-headers" PREFIX="$prefix" install
mkdir -p "$work/objects/ffmpeg"
cd "$work/objects/ffmpeg"
# Static codec libraries; dynamically linked distribution VA-API/DRM/TLS and libc.
# CUDA LLVM builds GPU scaling kernels without CUDA SDK or nonfree libnpp.
bash "$src/ffmpeg/configure" \
  --prefix="$prefix" --target-os=linux --arch="$ff_arch" --cpu="$ff_cpu" \
  --cc=clang --cxx=clang++ --ld=clang++ --ar=llvm-ar --ranlib=llvm-ranlib --nm=llvm-nm \
  --enable-gpl --disable-nonfree --disable-autodetect \
  --enable-static --disable-shared --disable-ffplay --disable-doc --disable-debug \
  --enable-libx264 --enable-libvpx --enable-libopus --enable-libdav1d --enable-zlib \
  --enable-vaapi --enable-libdrm --enable-gnutls --enable-ffnvcodec \
  --enable-cuda-llvm --nvccflags='--cuda-gpu-arch=sm_52 -O2' --enable-cuvid --enable-nvdec --enable-nvenc \
  --enable-filter=scale_cuda --enable-filter=scale_vaapi \
  --extra-cflags="-I$prefix/include -O2 $cpu_flags" \
  --extra-ldflags="-L$prefix/lib" --extra-libs='-lpthread -lm' \
  --extra-version="moartube-$target-r1"
make -j"$jobs"
make install
cp ffbuild/config.log "$root/build/ffmpeg/reports/$target/config.log"
cp config.h "$root/build/ffmpeg/reports/$target/config.h"
