/* global $ */
class MoarTubeCloudflareTunnelToggle {
  constructor(showAlert) {
    this.showAlert = showAlert;
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

  async update() {
    if (this.pending) return;
    const requested = this.checkbox.prop('checked');
    this.pending = true;
    this.checkbox.prop('disabled', true).attr('aria-busy', 'true');
    this.status.text('Updating Cloudflare Tunnels.');
    let failure = null;
    try {
      const response = await $.ajax({
        type: 'POST',
        url: '/settings/node/cloudflare/tunnel/toggle',
        data: JSON.stringify({ isEnabled: requested }),
        contentType: 'application/json; charset=utf-8',
        timeout: 155000,
      });
      if (typeof response.isCloudflareTunnelEnabled === 'boolean') {
        this.load(response);
      }
      if (response.isError) failure = response;
    } catch (error) {
      failure = { ...(error?.responseJSON || {}), admissionBusy: error?.status === 409 };
      if (typeof failure.isCloudflareTunnelEnabled === 'boolean') this.load(failure);
    }

    // Always refresh after errors/timeouts: an interrupted request may already have persisted.
    try {
      const [settings, runtime] = await Promise.allSettled([
        $.ajax({ type: 'GET', url: '/settings/node', cache: false, timeout: 15000 }),
        $.ajax({
          type: 'GET',
          url: '/settings/node/cloudflare/tunnel',
          cache: false,
          timeout: 15000,
        }),
      ]);
      if (settings.status === 'fulfilled' && settings.value && !settings.value.isError) {
        this.load(settings.value);
      } else {
        this.checkbox.prop('checked', this.confirmed);
      }
      const runtimeError =
        runtime.status === 'fulfilled' && runtime.value?.tunnel?.status === 'error';
      const refreshFailed =
        settings.status === 'rejected' ||
        runtime.status === 'rejected' ||
        !settings.value ||
        settings.value?.isError ||
        runtime.value?.isError ||
        !runtime.value?.tunnel;
      const message = failure
        ? failure.admissionBusy
          ? 'Another settings change is in progress. Wait for it to finish and try again.'
          : failure.settingsSaved
            ? 'Tunnel preference saved, but the tunnel could not reach the requested state. You can retry using the toggle.'
            : 'The tunnel change could not be confirmed. The toggle shows the last confirmed setting; refresh settings before retrying.'
        : refreshFailed
          ? 'The tunnel request completed, but its current state could not be refreshed. Refresh settings before retrying.'
          : runtimeError
            ? 'Tunnel preference saved, but the tunnel is reporting an error. You can retry using the toggle.'
            : 'Cloudflare Tunnels preference saved.';
      this.status.text(message);
      // Never insert provider errors, generated names, or public URLs into Client UI.
      this.showAlert(!!failure || !!refreshFailed || runtimeError, message);
    } catch {
      this.checkbox.prop('checked', this.confirmed);
      const message =
        'Cloudflare Tunnel state could not be refreshed. Refresh settings before retrying.';
      this.status.text(message);
      this.showAlert(true, message);
    } finally {
      this.pending = false;
      this.checkbox.prop('disabled', false).removeAttr('aria-busy');
    }
  }
}
