FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS node
FROM ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends \
    ca-certificates build-essential python3 pkg-config git xz-utils fakeroot \
    libgtk-3-0t64 libnss3 libnspr4 libxss1 libxtst6 libatspi2.0-0t64 libuuid1 \
    libgbm1 libasound2t64 libx11-xcb1 libnotify4 libsecret-1-0 xdg-utils \
    libva2 libva-drm2 libdrm2 libgnutls30t64 xvfb xauth dbus-x11 fonts-dejavu-core
WORKDIR /workspace
RUN mkdir -p /workspace/build/ffmpeg/artifacts/linux-x64
