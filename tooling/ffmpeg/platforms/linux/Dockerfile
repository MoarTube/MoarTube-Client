FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node
FROM ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# Bootstrap only the pinned CA data from Ubuntu's signed release repository.
# Extracting it avoids introducing rolling bootstrap dependencies.
RUN apt-get update --error-on=any && apt-get download ca-certificates=20240203 && \
    dpkg-deb -x ca-certificates_20240203_all.deb /ca-bootstrap && \
    mkdir -p /etc/ssl/certs && \
    cat /ca-bootstrap/usr/share/ca-certificates/mozilla/*.crt > /etc/ssl/certs/ca-certificates.crt
# Snapshot both compiler and development dependencies; never install a system FFmpeg.
RUN printf 'Types: deb\nURIs: http://snapshot.ubuntu.com/ubuntu/20261027T000000Z\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\nCheck-Valid-Until: no\n' > /etc/apt/sources.list.d/ubuntu.sources && \
    apt-get update --error-on=any && \
    apt-get install -y --no-install-recommends \
      build-essential clang llvm lld nasm pkg-config cmake ninja-build meson \
      python3 ca-certificates xz-utils patch libva-dev libdrm-dev libgnutls28-dev && \
    dpkg-query -W > /toolchain-packages.txt
WORKDIR /workspace
CMD ["node", "tooling/ffmpeg/scripts/build-linux-native.mjs"]
