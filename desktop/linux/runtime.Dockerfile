ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node
FROM ${UBUNTU_IMAGE}
COPY --from=node /usr/local/ /usr/local/
ENV DEBIAN_FRONTEND=noninteractive
# Test-only display and automation tools. The app DEB resolves its own libraries.
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends \
    ca-certificates xvfb xauth dbus-x11 fonts-dejavu-core procps apparmor && \
    useradd --create-home --uid 1100 desktop-test
WORKDIR /workspace
RUN target="linux-$(node -p process.arch)" && mkdir -p /workspace/scripts /workspace/build/desktop/reports/$target /workspace/build/desktop/profiles/$target
