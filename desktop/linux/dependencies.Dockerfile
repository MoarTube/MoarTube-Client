ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ENV ELECTRON_CACHE=/root/.cache/electron ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder
WORKDIR /workspace
COPY downloads-cache.tar /tmp/downloads-cache.tar
RUN mkdir -p /root/.npm /root/.cache/electron /root/.cache/electron-builder && tar -xf /tmp/downloads-cache.tar -C /root
COPY package.json package-lock.json ./
COPY prefetch-desktop-tools.mjs scripts/prefetch-desktop-tools.mjs
COPY builder-cache.cjs desktop/builder-cache.cjs
RUN npm ci --include=optional --ignore-scripts --no-audit --no-fund && \
    node node_modules/electron/install.js && node scripts/prefetch-desktop-tools.mjs
