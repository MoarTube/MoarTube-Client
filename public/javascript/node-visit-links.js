/* global $, MoarTubePublicNodeUrl */
class MoarTubeNodeVisitLinks {
  static load(settings) {
    const root = document.querySelector('[data-node-visit-links]');
    if (!root) return;
    if (!this.current || this.current.root !== root) {
      this.current?.stop();
      this.current = new MoarTubeNodeVisitLinks(root);
    }
    this.current.start(settings);
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
    this.publicLink = root.querySelector('[data-node-public-link]');
    this.tunnelLink = root.querySelector('[data-node-tunnel-link]');
    this.tunnelItem = root.querySelector('[data-node-tunnel-item]');
    this.requests = [];
    this.generation = 0;
    this.refreshOnFocus = () => void this.refresh();
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

  start(settings) {
    this.stop();
    this.initialSettings = settings;
    this.active = true;
    this.render(settings, null, true);
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 15000);
    window.addEventListener('focus', this.refreshOnFocus);
    document.addEventListener('visibilitychange', this.refreshOnFocus);
  }

  async refresh() {
    if (!this.active || this.pending || document.hidden) return;
    this.pending = true;
    const generation = this.generation;
    this.requests = ['/settings/node', '/settings/node/cloudflare/tunnel'].map((url) =>
      $.ajax({ type: 'GET', url, cache: false, timeout: 10000 })
    );
    const [settings, runtime] = await Promise.allSettled(this.requests);
    if (!this.active || generation !== this.generation) return;
    this.pending = false;
    this.requests = [];
    this.render(
      settings.status === 'fulfilled' && !settings.value?.isError ? settings.value : null,
      runtime.status === 'fulfilled' && !runtime.value?.isError ? runtime.value?.tunnel : null
    );
  }

  stop() {
    this.active = false;
    this.pending = false;
    this.generation++;
    window.clearInterval(this.timer);
    this.requests.forEach((request) => request.abort());
    this.requests = [];
    window.removeEventListener('focus', this.refreshOnFocus);
    document.removeEventListener('visibilitychange', this.refreshOnFocus);
  }
}
window.MoarTubeNodeVisitLinks = MoarTubeNodeVisitLinks;
