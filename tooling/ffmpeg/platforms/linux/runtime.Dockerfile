ARG UBUNTU_IMAGE
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS node
FROM ${UBUNTU_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# Deliberately no compiler, development headers, system FFmpeg or GPU driver.
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends \
    libva2 libva-drm2 libdrm2 libgnutls30t64 ca-certificates && \
    dpkg-query -W > /runtime-packages.txt
WORKDIR /workspace
RUN mkdir -p /workspace/build/ffmpeg/install
