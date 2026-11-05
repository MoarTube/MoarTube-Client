(function () {
  'use strict';

  function origin(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : null;
    } catch (_) {
      return null;
    }
  }

  class MoarTubeShareAddress {
    constructor(root, onChange) {
      this.active = true;
      this.requests = [];
      this.publicUrl = null;
      this.onChange = onChange;
      const region = document.createElement('div');
      region.className = 'text-start mb-3';
      region.innerHTML =
        '<label class="form-label" for="share-address-select">Share using</label>' +
        '<select id="share-address-select" class="form-select" aria-describedby="share-address-status" disabled></select>' +
        '<p id="share-address-status" class="text-sm mt-1 mb-0" role="status" aria-live="polite">Loading share addresses…</p>';
      root.prepend(region);
      this.region = region;
      this.label = region.querySelector('label');
      this.select = region.querySelector('select');
      this.status = region.querySelector('p');
      this.select.addEventListener('change', () => this.update());
      this.load();
    }

    async load() {
      const requests = ['/settings/node', '/settings/node/cloudflare/tunnel'].map((url) =>
        $.ajax({ type: 'GET', url, cache: false, timeout: 10000 })
      );
      this.requests = requests;
      const [settingsResult, tunnelResult] = await Promise.allSettled(requests);
      if (!this.active) return;
      const settings =
        settingsResult.status === 'fulfilled' && !settingsResult.value.isError
          ? settingsResult.value
          : null;
      const tunnel =
        tunnelResult.status === 'fulfilled' && !tunnelResult.value.isError
          ? tunnelResult.value.tunnel
          : null;
      try {
        this.publicUrl = settings ? origin(MoarTubePublicNodeUrl.build(settings)) : null;
      } catch (_) {
        /* Incomplete settings do not provide a share address. */
      }
      const tunnelEnabled = settings !== null && settings.isCloudflareTunnelEnabled !== false;
      const tunnelUrl =
        tunnelEnabled && tunnel?.status === 'running' && ['quick', 'named'].includes(tunnel.mode)
          ? origin(tunnel.publicUrl)
          : null;
      this.cdnEnabled = settings?.isCloudflareCdnEnabled === true;
      this.label.hidden = this.cdnEnabled;
      this.select.hidden = this.cdnEnabled;
      // Retain an error message when CDN sharing has no valid public address.
      this.region.hidden = this.cdnEnabled && Boolean(this.publicUrl);
      const add = (value, label, url) => {
        const option = new Option(label + (url ? ' · ' + new URL(url).host : ''), value);
        option.disabled = !url;
        option.dataset.url = url || '';
        this.select.add(option);
      };
      add(
        'public',
        this.publicUrl ? 'Public node URL' : 'Public node URL — unavailable',
        this.publicUrl
      );
      if (!this.cdnEnabled && (!tunnelUrl || tunnelUrl !== this.publicUrl)) {
        const label =
          tunnel?.mode === 'named'
            ? 'Named tunnel'
            : tunnel?.mode === 'quick'
              ? 'Quick tunnel'
              : 'Tunnel URL';
        let state = 'unavailable';
        if (settings?.isCloudflareTunnelEnabled === false) state = 'disabled';
        else if (settings && ['starting', 'stopped', 'error'].includes(tunnel?.status)) {
          state = tunnel.status;
        }
        add('tunnel', label + (tunnelUrl ? '' : ' — ' + state), tunnelUrl);
      }
      const available = Array.from(this.select.options).filter((option) => !option.disabled);
      const selected =
        available.find((option) => option.value === (this.cdnEnabled ? 'public' : 'tunnel')) ||
        available[0];
      this.select.disabled = available.length < 2;
      this.select.value = selected?.value || '';
      this.update();
    }

    update() {
      const baseUrl = this.select.selectedOptions[0]?.dataset.url || null;
      this.status.textContent = baseUrl
        ? ''
        : 'No share address is available. Check node and tunnel settings.';
      this.status.hidden = Boolean(baseUrl);
      this.onChange(baseUrl);
    }

    sourceUrl(source, baseUrl, originalPublicUrl) {
      if (!baseUrl) return '';
      try {
        const url = new URL(source, this.publicUrl || originalPublicUrl);
        if ([this.publicUrl, origin(originalPublicUrl)].includes(url.origin)) {
          return baseUrl + url.pathname + url.search + url.hash;
        }
        return url.href;
      } catch (_) {
        return '';
      }
    }

    destroy() {
      this.active = false;
      this.requests.forEach((request) => request.abort());
    }
  }

  window.MoarTubeShareAddress = MoarTubeShareAddress;
})();
