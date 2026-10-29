ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node
FROM ${UBUNTU_IMAGE}
COPY --from=node /usr/local/ /usr/local/
ENV DEBIAN_FRONTEND=noninteractive
# Download test tools and declared app dependencies before any compilation.
COPY runtime-packages.json /runtime-packages.json
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends \
    $(node -p 'JSON.parse(require("fs").readFileSync("/runtime-packages.json")).map(x=>x.split(" ")[0]).join(" ")') \
    xvfb xauth dbus-x11 fonts-dejavu-core procps apparmor && \
    useradd --create-home --uid 1100 desktop-test
WORKDIR /workspace
RUN printf '{"private":true,"type":"module"}\n' > package.json && npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.64.1
RUN target="linux-$(node -p process.arch)" && mkdir -p /workspace/scripts /workspace/build/desktop/reports/$target /workspace/build/desktop/profiles/$target
