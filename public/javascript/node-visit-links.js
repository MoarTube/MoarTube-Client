/* global $, MoarTubePublicNodeUrl */
class MoarTubeNodeVisitLinks {
  static load(settings, tunnel) {
    const root = document.querySelector('[data-node-visit-links]');
    if (!root) return;
    if (!this.current || this.current.root !== root) {
      this.current?.stop();
      this.current = new MoarTubeNodeVisitLinks(root);
    }
    this.current.start(settings, tunnel);
  }

  constructor(root) {
    this.root = root;
    root.innerHTML = `
						<a class="node-visit-link" data-node-public-link target="_blank" rel="noopener noreferrer" aria-disabled="true">
							<i class="fas fa-globe node-visit-icon" aria-hidden="true"></i>
							<span class="node-visit-text"><span class="node-visit-label">Public URL</span><span class="node-visit-address">Loading…</span></span>
							<i class="fas fa-external-link-alt text-xs node-visit-external" aria-hidden="true" hidden></i>
						</a>
						<div data-node-tunnel-item>
							<a class="node-visit-link" data-node-tunnel-link target="_blank" rel="noopener noreferrer" aria-disabled="true">
								<i class="fas fa-link node-visit-icon" aria-hidden="true"></i>
								<span class="node-visit-text"><span class="node-visit-label">Tunnel URL</span><span class="node-visit-address">Loading…</span></span>
								<i class="fas fa-external-link-alt text-xs node-visit-external" aria-hidden="true" hidden></i>
							</a>
						</div>
					`;
    root.querySelectorAll('.node-visit-link').forEach((link) => {
      const row = document.createElement('div');
      row.className = 'node-visit-row';
      link.before(row);
      row.append(link);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'node-visit-copy';
      button.disabled = true;
      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-copy" viewBox="0 0 16 16" aria-hidden="true">' +
        '<path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/></svg>' +
        '<span class="node-visit-copy-status" role="status" aria-live="polite"></span>';
      row.append(button);
      button.addEventListener('click', () => void this.copyLink(button));
    });
    this.publicLink = root.querySelector('[data-node-public-link]');
    this.tunnelLink = root.querySelector('[data-node-tunnel-link]');
    this.tunnelItem = root.querySelector('[data-node-tunnel-item]');
    this.requests = [];
    this.generation = 0;
    window.addEventListener('beforeunload', () => this.stop());
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) this.start(this.initialSettings);
    });
  }

  setLink(link, value, unavailable) {
    let url;
    try {
      const parsed = new URL(value);
      if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password) {
        url = parsed.origin + '/';
      }
    } catch (_) {
      /* Missing addresses are displayed as unavailable. */
    }
    link.querySelector('.node-visit-address').textContent = url || unavailable;
    link.querySelector('.node-visit-external').hidden = !url;
    const label = link.querySelector('.node-visit-label').textContent;
    const button = link.parentElement.querySelector('.node-visit-copy');
    if (button.dataset.url !== (url || '')) {
      this.resetCopy(button);
      button.dataset.url = url || '';
    }
    button.disabled = !url;
    button.title = 'Copy ' + label;
    button.setAttribute('aria-label', 'Copy ' + label);
    link.title = url || unavailable;
    link.setAttribute('aria-label', label + ': ' + (url || unavailable));
    if (url) {
      link.href = url;
      link.removeAttribute('aria-disabled');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
    }
  }

  resetCopy(button) {
    window.clearTimeout(button.copyTimer);
    button.querySelector('[role="status"]').textContent = '';
  }

  async copyLink(button) {
    const url = button.dataset.url;
    if (!url || button.disabled) return;
    this.resetCopy(button);
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (_) {
      // Support clipboard copying on HTTP connections and older browsers.
      const input = document.createElement('textarea');
      input.value = url;
      input.style.cssText = 'position:fixed;left:-9999px;top:0';
      input.setAttribute('readonly', '');
      const focused = document.activeElement;
      document.body.append(input);
      try {
        input.select();
        copied = document.execCommand('copy');
      } catch (_) {
        /* Report failure without displaying a success indicator. */
      } finally {
        input.remove();
        focused?.focus({ preventScroll: true });
      }
    }
    if (button.dataset.url !== url || !button.isConnected) return;
    button.querySelector('[role="status"]').textContent = copied ? 'Copied!' : 'Copy failed';
    button.copyTimer = window.setTimeout(() => this.resetCopy(button), 2000);
  }

  render(settings, tunnel, loading = false) {
    let publicUrl;
    try {
      if (settings) publicUrl = MoarTubePublicNodeUrl.build(settings);
    } catch (_) {
      /* Incomplete settings do not provide a public address. */
    }
    this.setLink(this.publicLink, publicUrl, 'Unavailable');
    this.tunnelItem.hidden = settings?.isCloudflareCdnEnabled === true;
    const enabled = settings && settings.isCloudflareTunnelEnabled !== false;
    const running =
      enabled && tunnel?.status === 'running' && ['quick', 'named'].includes(tunnel.mode);
    const state =
      settings?.isCloudflareTunnelEnabled === false
        ? 'Disabled'
        : loading
          ? 'Loading…'
          : tunnel?.status === 'starting'
            ? 'Starting…'
            : tunnel?.status === 'stopped'
              ? 'Stopped'
              : 'Unavailable';
    this.setLink(this.tunnelLink, running ? tunnel.publicUrl : undefined, state);
  }

  start(settings, tunnel) {
    this.stop();
    this.initialSettings = settings;
    this.active = true;
    if (settings?.isCloudflareTunnelEnabled === false || settings?.isCloudflareCdnEnabled === true) {
      this.render(settings, null);
    } else if (tunnel !== undefined) {
      this.updateTunnel(tunnel);
    } else {
      this.render(settings, null, true);
      void this.refresh();
    }
  }

  updateTunnel(tunnel) {
    this.render(this.initialSettings, tunnel);
    // Retry unavailable status checks and follow startup until it settles.
    if (!tunnel || tunnel.status === 'starting') {
      this.timer = window.setTimeout(() => void this.refresh(), 2000);
    }
  }

  async refresh() {
    if (!this.active || this.pending) return;
    window.clearTimeout(this.timer);
    this.pending = true;
    const generation = this.generation;
    const request = $.ajax({
      type: 'GET', url: '/settings/node/cloudflare/tunnel', cache: false, timeout: 10000,
    });
    this.requests = [request];
    let tunnel = null;
    try {
      const runtime = await request;
      if (!runtime?.isError) tunnel = runtime?.tunnel ?? null;
    } catch (_) {
      /* Retry transient request failures without overlapping requests. */
    }
    if (!this.active || generation !== this.generation) return;
    this.pending = false;
    this.requests = [];
    this.updateTunnel(tunnel);
  }

  stop() {
    this.active = false;
    this.pending = false;
    this.generation++;
    window.clearTimeout(this.timer);
    this.requests.forEach((request) => request.abort());
    this.requests = [];
  }
}
window.MoarTubeNodeVisitLinks = MoarTubeNodeVisitLinks;
