ARG UBUNTU_IMAGE
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node
FROM ${UBUNTU_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# Deliberately no compiler, development headers, system FFmpeg or GPU driver.
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends \
    libva2 libva-drm2 libdrm2 libgnutls30t64 ca-certificates && \
    dpkg-query -W > /runtime-packages.txt
WORKDIR /workspace
RUN mkdir -p /workspace/build/ffmpeg/install
