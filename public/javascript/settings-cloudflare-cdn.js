/* global $, Swal */
const MOARTUBE_CLOUDFLARE_CDN_TITLE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 84.953" width="256" height="85"><path d="M253.827 69.103a2.16 2.16 0 0 1-2.173-2.173c0-1.175.962-2.173 2.173-2.173 1.175 0 2.173.962 2.173 2.173a2.21 2.21 0 0 1-2.173 2.173m0-3.918a1.75 1.75 0 0 0-1.745 1.745 1.75 1.75 0 0 0 1.745 1.745 1.75 1.75 0 0 0 1.745-1.745 1.75 1.75 0 0 0-1.745-1.745m1.104 2.885h-.5l-.427-.82h-.57v.82h-.463v-2.387h1.14c.5 0 .82.32.82.784a.74.74 0 0 1-.499.712l.5.9zm-.855-1.247c.178 0 .356-.107.356-.356 0-.285-.142-.356-.356-.356h-.712v.712h.712zM42.673 84.526h-15.2V64.543h5.557v15.138h9.653zm5.735-9.938v-.07c0-5.735 4.63-10.4 10.793-10.4s10.722 4.595 10.722 10.33v.07c0 5.735-4.63 10.4-10.793 10.4s-10.722-4.595-10.722-10.33m15.886 0v-.07c0-2.885-2.066-5.38-5.13-5.38-3.028 0-5.058 2.458-5.058 5.343v.07c0 2.885 2.066 5.38 5.094 5.38 3.063 0 5.094-2.458 5.094-5.343m12.43 1.175v-11.22h5.628v11.113c0 2.885 1.46 4.24 3.67 4.24s3.67-1.318 3.67-4.096V64.543h5.628V75.62c0 6.447-3.67 9.26-9.368 9.26-5.664 0-9.226-2.85-9.226-9.12m27.07-11.22h7.694c7.124 0 11.292 4.096 11.292 9.867v.07c0 5.77-4.203 10.045-11.398 10.045h-7.587V64.543zm7.8 15.067c3.313 0 5.52-1.817 5.52-5.058v-.07c0-3.206-2.208-5.058-5.52-5.058h-2.244v10.152h2.244zm24.756-6.803h9.475v4.595h-9.475v7.124h-5.52V64.543h15.993v4.844h-10.472zm33.376 11.72h-15.2V64.543h5.52v15.138h9.69zM184.19 64.4h5.343l8.513 20.125h-5.95l-1.46-3.562h-7.694l-1.425 3.562h-5.806L184.19 64.4zm4.88 12.253L186.862 71l-2.244 5.664h4.452zm16.1-12.11h9.44c3.063 0 5.165.784 6.518 2.173 1.175 1.14 1.78 2.67 1.78 4.666v.07c0 3.063-1.64 5.094-4.096 6.127l4.773 6.982h-6.412l-4.025-6.055h-2.422v6.055h-5.557V64.543zm9.2 9.582c1.888 0 2.956-.926 2.956-2.35v-.07c0-1.567-1.14-2.35-2.992-2.35h-3.633v4.773h3.67zm22.013-1.852h9.582v4.38h-9.582v3.17h10.722v4.702h-16.207V64.543h16.065v4.702h-10.58zM15.352 76.94c-.784 1.745-2.422 2.992-4.56 2.992-3.028 0-5.094-2.53-5.094-5.38v-.07c0-2.885 2.03-5.343 5.058-5.343 2.28 0 4.025 1.39 4.737 3.313h5.842c-.926-4.773-5.13-8.3-10.543-8.3C4.63 64.15 0 68.818 0 74.552v.07c0 5.735 4.56 10.33 10.722 10.33 5.272 0 9.404-3.42 10.472-7.98l-5.842-.036z" fill="#404041"/><path d="M159.97 54.926h80.43V32.663l-15.28-8.762-2.636-1.14-62.513.427z" fill="#fff"/><path d="M212.58 52.005c.748-2.565.463-4.916-.784-6.66-1.14-1.603-3.063-2.53-5.38-2.636l-43.848-.57a.81.81 0 0 1-.677-.356c-.142-.214-.178-.5-.107-.784.142-.427.57-.748 1.033-.784l44.24-.57c5.236-.25 10.935-4.488 12.93-9.69l2.53-6.6c.107-.285.142-.57.07-.855C219.74 9.617 208.234 0 194.485 0c-12.68 0-23.438 8.193-27.285 19.555-2.493-1.852-5.664-2.85-9.083-2.53-6.09.606-10.97 5.485-11.576 11.576-.142 1.567-.036 3.1.32 4.524-9.938.285-17.88 8.406-17.88 18.415 0 .9.07 1.78.178 2.67.07.427.427.748.855.748h80.928c.463 0 .9-.32 1.033-.784l.606-2.173z" fill="#f38020"/><path d="M226.543 23.83l-1.21.036c-.285 0-.534.214-.64.5l-1.7 5.95c-.748 2.565-.463 4.916.784 6.66 1.14 1.603 3.063 2.53 5.38 2.636l9.332.57a.81.81 0 0 1 .677.356c.142.214.178.534.107.784-.142.427-.57.748-1.033.784l-9.724.57c-5.272.25-10.935 4.488-12.93 9.69l-.712 1.817c-.142.356.107.712.5.712h33.41c.392 0 .748-.25.855-.64.57-2.066.9-4.24.9-6.483 0-13.18-10.757-23.937-23.972-23.937" fill="#faae40"/></svg>';
class MoarTubeCloudflareCdn {
  constructor(showAlert, tunnels, onSettingsChanged = () => {}) {
    this.showAlert = showAlert;
    this.tunnels = tunnels;
    this.onSettingsChanged = onSettingsChanged;
    this.confirmed = false;
    this.pending = false;
    this.incomplete = false;
    this.transition = null;
    this.retryError = '';
    this.checkbox = $('#cloudflare-one-click-cdn-checkbox');
    $('#cloudflare-cdn-retry').on('click', () => void this.toggle(true));
  }

  load(settings) {
    this.confirmed = settings.isCloudflareCdnEnabled === true;
    if (Object.prototype.hasOwnProperty.call(settings, 'cdnTransition')) this.transition = settings.cdnTransition;
    if (typeof settings.cloudflareAddressMigrationPending === 'boolean') {
      this.incomplete = settings.cloudflareAddressMigrationPending;
    }
    this.checkbox.prop('checked', this.confirmed);
    this.checkbox.prop('disabled', this.pending || this.incomplete);
    this.renderRecovery();
  }

  renderRecovery() {
    const targetEnabled = this.transition?.targetEnabled ?? this.confirmed;
    $('#cloudflare-cdn-recovery').prop('hidden', !this.incomplete).attr('aria-busy', String(this.pending));
    $('#cloudflare-cdn-recovery-title').text(targetEnabled ? 'CDN setup incomplete' : 'CDN removal incomplete');
    $('#cloudflare-cdn-retry').prop('disabled', this.pending).text(
      this.pending
        ? targetEnabled ? 'Retrying setup…' : 'Retrying removal…'
        : targetEnabled ? 'Retry setup' : 'Retry removal'
    );
    $('#cloudflare-cdn-recovery-error').prop('hidden', !this.retryError).text(this.retryError);
  }

  async toggle(retrying = false) {
    if (this.pending) return;
    if (retrying && !this.incomplete) return;
    if (!retrying && this.incomplete) {
      this.checkbox.prop('checked', this.confirmed);
      return;
    }
    if (retrying && !this.transition?.id) {
      this.retryError = 'This older migration has no saved transition details. Repair the Node recovery state before retrying.';
      this.renderRecovery();
      return;
    }
    const enabled = retrying ? this.confirmed : this.checkbox.prop('checked');
    this.pending = true;
    this.retryError = '';
    this.renderRecovery();
    this.checkbox.prop('disabled', true);
    let failure;
    try {
      let data = retrying ? { transitionId: this.transition.id } : {};
      if (enabled && !retrying) {
        const intro = await Swal.fire({
          customClass: { popup: 'cloudflare-cdn-modal' },
          width: 'min(32rem, calc(100vw - 2rem))',
          title: MOARTUBE_CLOUDFLARE_CDN_TITLE,
          text: 'Integrate your MoarTube Node with the Cloudflare Network to distribute and cache your content.',
          showCloseButton: true,
          confirmButtonText: 'Continue',
        });
        if (!intro.isConfirmed) {
          this.checkbox.prop('checked', this.confirmed);
          return;
        }
        const form = await Swal.fire({
          customClass: { popup: 'cloudflare-cdn-modal' },
          width: 'min(32rem, calc(100vw - 2rem))',
          title: MOARTUBE_CLOUDFLARE_CDN_TITLE,
          showCloseButton: true,
          confirmButtonText: 'Enable',
          didOpen: () => {
            $('#cloudflareEmailAddress, #cloudflareZoneId, #cloudflareGlobalApiKey').on(
              'input',
              () => Swal.resetValidationMessage()
            );
          },
          html:
            '<div class="text-start">' +
            '<input id="cloudflareEmailAddress" aria-label="Cloudflare Email Address" class="form-control mb-3" type="text" required autocomplete="off" placeholder="Cloudflare Email Address">' +
            '<input id="cloudflareZoneId" aria-label="Cloudflare Zone ID" class="form-control mb-3" type="text" required autocomplete="off" placeholder="Cloudflare Zone ID">' +
            '<input id="cloudflareGlobalApiKey" aria-label="Cloudflare Global API Key" class="form-control" type="password" required autocomplete="off" placeholder="Cloudflare Global API Key">' +
            '</div>',
          preConfirm: () => {
            const cloudflareEmailAddress = String($('#cloudflareEmailAddress').val() || '').trim();
            const cloudflareZoneId = String($('#cloudflareZoneId').val() || '').trim();
            const cloudflareGlobalApiKey = String($('#cloudflareGlobalApiKey').val() || '').trim();
            if (!cloudflareEmailAddress || !cloudflareZoneId || !cloudflareGlobalApiKey) {
              Swal.showValidationMessage('Please enter email, zone ID, and global API key');
              return false;
            }
            return {
              cloudflareEmailAddress,
              cloudflareZoneId,
              cloudflareGlobalApiKey,
            };
          },
        });
        if (!form.isConfirmed) {
          this.checkbox.prop('checked', this.confirmed);
          return;
        }
        data = form.value;
      }
      try {
        const result = await $.ajax({
          type: 'POST',
          url: retrying ? '/settings/node/cloudflare/retry'
            : enabled ? '/settings/node/cloudflare/configure' : '/settings/node/cloudflare/clear',
          data: JSON.stringify(data),
          contentType: 'application/json; charset=utf-8',
          timeout: 275000,
        });
        if (typeof result.isCloudflareCdnEnabled === 'boolean') this.load(result);
        if (result.isError) failure = result;
      } catch (error) {
        failure = { ...(error?.responseJSON || {}), admissionBusy: error?.status === 409 };
        if (typeof failure.isCloudflareCdnEnabled === 'boolean') this.load(failure);
      }
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
        this.load(settings.value);
        this.tunnels.load(settings.value);
        this.onSettingsChanged(settings.value,
          runtime.status === 'fulfilled' && !runtime.value?.isError ? runtime.value?.tunnel ?? null : null);
      } else this.checkbox.prop('checked', this.confirmed);
      const runtimeFailed =
        runtime.status === 'rejected' ||
        !runtime.value?.tunnel ||
        runtime.value?.isError ||
        runtime.value?.tunnel?.status === 'error';
      const message = failure
        ? failure.admissionBusy
          ? 'Another settings change is in progress. Wait for it to finish and try again.'
          : failure.settingsSaved
            ? 'CDN settings saved, but distribution or tunnel reconciliation is incomplete. Use the retry button below to finish.'
            : 'Cloudflare CDN could not be configured. Check your credentials and domain; the controls show the last confirmed settings.'
        : !refreshed || runtimeFailed
          ? 'CDN request completed, but the current tunnel state could not be confirmed. Refresh settings before retrying.'
          : 'Cloudflare CDN settings saved.';
      this.showAlert(!!failure || !refreshed || runtimeFailed, message);
      if (failure || !refreshed || runtimeFailed) this.retryError = message;
    } catch {
      this.checkbox.prop('checked', this.confirmed);
      this.showAlert(
        true,
        'Cloudflare CDN state could not be confirmed. Refresh settings before retrying.'
      );
      this.retryError = 'The Node could not be reached. Check your connection and retry.';
    } finally {
      this.pending = false;
      this.checkbox.prop('disabled', this.incomplete);
      this.renderRecovery();
    }
  }
}
