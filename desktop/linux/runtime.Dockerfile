ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS node
FROM ${UBUNTU_IMAGE}
COPY --from=node /usr/local/ /usr/local/
ENV DEBIAN_FRONTEND=noninteractive
# Test-only display and automation tools. The app DEB resolves its own libraries.
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends \
    ca-certificates xvfb xauth dbus-x11 fonts-dejavu-core procps apparmor && \
    useradd --create-home --uid 1100 desktop-test
WORKDIR /workspace
RUN target="linux-$(node -p process.arch)" && mkdir -p /workspace/scripts /workspace/build/desktop/reports/$target /workspace/build/desktop/profiles/$target
