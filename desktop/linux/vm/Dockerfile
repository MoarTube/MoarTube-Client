FROM ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends qemu-system-arm qemu-utils e2fsprogs ca-certificates python3 xz-utils file
WORKDIR /work
