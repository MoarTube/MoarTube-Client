ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /opt/moartube-node-source
COPY downloads-cache.tar /tmp/node-downloads-cache.tar
RUN tar -xf /tmp/node-downloads-cache.tar -C /root
COPY package.json package-lock.json ./
RUN npm ci --include=optional --ignore-scripts --no-audit --no-fund && npm rebuild better-sqlite3 --build-from-source
COPY install-cloudflared.mjs cloudflared-release.mjs scripts/
RUN mkdir -p resources/cloudflared/linux-$(node -p process.arch) && \
    node scripts/install-cloudflared.mjs "$(node -p "process.arch === 'x64' ? 'amd64' : 'arm64'")" "resources/cloudflared/linux-$(node -p process.arch)/cloudflared"
WORKDIR /workspace
RUN mkdir -p /workspace/build/desktop
