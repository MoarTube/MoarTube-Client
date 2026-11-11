/* global $ */
class MoarTubeCloudflareTunnelToggle {
  constructor(showAlert, onSettingsChanged = () => {}) {
    this.showAlert = showAlert;
    this.onSettingsChanged = onSettingsChanged;
    this.confirmed = true;
    this.pending = false;
    this.checkbox = $('#cloudflare-tunnels-checkbox');
    this.status = $('#cloudflare-tunnels-status');
  }

  load(nodeSettings) {
    this.confirmed = nodeSettings.isCloudflareTunnelEnabled !== false;
    this.checkbox.prop('checked', this.confirmed);
  }

  start() {
    this.checkbox.off('change.moartubeTunnel').on('change.moartubeTunnel', () => {
      void this.update();
    });
  }

  save(isEnabled) {
    return $.ajax({
      type: 'POST',
      url: '/settings/node/cloudflare/tunnel/toggle',
      data: JSON.stringify({ isEnabled }),
      contentType: 'application/json; charset=utf-8',
      timeout: 155000,
    });
  }

  async resetFailedEnable(preferenceKnownOff) {
    this.confirmed = false;
    this.checkbox.prop('checked', false);
    if (preferenceKnownOff) return true;
    try {
      const response = await this.save(false);
      return response?.isCloudflareTunnelEnabled === false;
    } catch (error) {
      // A stop failure can still have successfully saved the disabled preference.
      return error?.responseJSON?.isCloudflareTunnelEnabled === false;
    }
  }

  async update() {
    if (this.pending) return;
    const requested = this.checkbox.prop('checked');
    this.pending = true;
    this.checkbox.prop('disabled', true).attr('aria-busy', 'true');
    this.status.text('Updating Cloudflare Tunnels.');
    let refreshedSettings;
    let refreshedTunnel = null;
    try {
      let failure = null;
      let mutationSucceeded = false;
      try {
        const response = await this.save(requested);
        mutationSucceeded =
          response?.isError === false && response.isCloudflareTunnelEnabled === requested;
        if (typeof response?.isCloudflareTunnelEnabled === 'boolean') this.load(response);
        if (!mutationSucceeded) failure = response || {};
      } catch (error) {
        failure = { ...(error?.responseJSON || {}), admissionBusy: error?.status === 409 };
        if (typeof failure.isCloudflareTunnelEnabled === 'boolean') this.load(failure);
      }

      // Refresh even after timeouts: the request may already have saved its preference.
      const [settings, runtime] = await Promise.allSettled([
        $.ajax({ type: 'GET', url: '/settings/node', cache: false, timeout: 15000 }),
        $.ajax({
          type: 'GET',
          url: '/settings/node/cloudflare/tunnel',
          cache: false,
          timeout: 15000,
        }),
      ]);
      const refreshed =
        settings.status === 'fulfilled' && settings.value && !settings.value.isError;
      if (refreshed) {
        refreshedSettings = settings.value;
        this.load(settings.value);
      } else this.checkbox.prop('checked', this.confirmed);
      const tunnel =
        runtime.status === 'fulfilled' && !runtime.value?.isError ? runtime.value?.tunnel : null;
      refreshedTunnel = tunnel;
      const refreshFailed = !refreshed || !tunnel;
      const runtimeError = tunnel?.status === 'error';
      const running = tunnel?.status === 'running' && ['quick', 'named'].includes(tunnel.mode);

      if (requested && (failure || refreshFailed || !this.confirmed || !running)) {
        const rateLimited =
          failure?.tunnel?.failureReason === 'rate-limited' ||
          tunnel?.failureReason === 'rate-limited';
        const reset = await this.resetFailedEnable(
          refreshed && settings.value.isCloudflareTunnelEnabled === false
        );
        const message = failure?.admissionBusy
          ? 'Another settings change is in progress. The switch is off. Wait for it to finish and try again.'
          : reset
            ? rateLimited
              ? 'Cloudflare is rate-limiting Quick Tunnel creation (HTTP 429). The preference is off. Wait before trying again.'
              : 'Cloudflare Tunnels could not be enabled. The preference is off. Please try again.'
            : rateLimited
              ? 'Cloudflare is rate-limiting Quick Tunnel creation (HTTP 429). The switch is off, but the saved preference could not be confirmed as off. Refresh settings before retrying.'
              : 'Cloudflare Tunnels could not be enabled. The switch is off, but the saved preference could not be confirmed as off. Refresh settings before retrying.';
        this.status.text(message);
        this.showAlert(true, message);
        return;
      }

      if (failure || refreshFailed || runtimeError) {
        const message = failure?.admissionBusy
          ? 'Another settings change is in progress. Wait for it to finish and try again.'
          : failure?.settingsSaved
            ? 'Tunnel preference saved, but the tunnel could not reach the requested state. You can retry using the toggle.'
            : 'The tunnel change could not be confirmed. Refresh settings before retrying.';
        this.status.text(message);
        // Never insert provider errors, generated names, or public URLs into Client UI.
        this.showAlert(true, message);
      } else {
        // Successful toggles are silent, including the live status region.
        this.status.text('');
      }
    } catch {
      if (requested) await this.resetFailedEnable(false);
      else this.checkbox.prop('checked', this.confirmed);
      const message =
        'Cloudflare Tunnel state could not be confirmed. Refresh settings before retrying.';
      this.status.text(message);
      this.showAlert(true, message);
    } finally {
      if (refreshedSettings) {
        this.onSettingsChanged({ ...refreshedSettings, isCloudflareTunnelEnabled: this.confirmed }, refreshedTunnel);
      }
      this.pending = false;
      this.checkbox.prop('disabled', false).removeAttr('aria-busy');
    }
  }
}
