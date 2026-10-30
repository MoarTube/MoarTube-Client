class MoarTubeStorageMetrics {
  constructor() {
    this.active = true;
    this.requests = new Set();
    const stop = () => {
      this.active = false;
      for (const request of this.requests) request.abort();
    };
    window.addEventListener('beforeunload', stop);
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) this.start();
    });
  }

  start() {
    this.active = true;
    this.refresh();
  }

  formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const unit = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, unit)).toLocaleString(undefined, {
      maximumFractionDigits: unit === 0 ? 0 : 2,
    }) + ' ' + units[unit];
  }

  refresh() {
    if (!this.active || this.requests.size > 0) return;
    for (const target of ['client', 'node']) {
      const prefix = '#metrics-' + target;
      $(prefix).attr('aria-busy', 'true');
      $(prefix + '-status').text('Calculating...').prop('hidden', false);
      const request = $.ajax({ url: '/settings/metrics/' + target, dataType: 'json', timeout: 120000 });
      this.requests.add(request);
      request.done((data) => {
        if (data.isError || !data.metrics) {
          this.showError(target);
          return;
        }
        const metrics = data.metrics;
        const elastic = metrics.storageMode === 's3provider';
        const fields = { media: metrics.mediaBytes, available: metrics.availableBytes, total: metrics.totalBytes };
        if (!elastic && (metrics.storageMode !== 'filesystem' || Object.values(fields).some(value => !Number.isFinite(value) || value < 0))) {
          this.showError(target);
          return;
        }
        $(prefix + '-local').prop('hidden', elastic);
        $(prefix + '-elastic').prop('hidden', !elastic);
        $(prefix + '-storage').text(elastic ? 'S3 object storage' : 'Local storage');
        const total = elastic ? 0 : metrics.totalBytes;
        const media = Math.min(total, elastic ? 0 : metrics.mediaBytes);
        const occupied = Math.min(total, Math.max(media, total - metrics.availableBytes));
        const usage = total > 0 ? occupied / total * 100 : 0;
        const mediaShare = occupied > 0 ? media / occupied * 100 : 0;
        $(prefix + '-capacity').prop('hidden', false);
        $(prefix + '-occupied').css({ width: usage + '%', minWidth: media > 0 ? '3px' : '0' });
        $(prefix + '-usage-bar').css({ width: mediaShare + '%', minWidth: media > 0 ? '3px' : '0' });
        if (elastic || metrics.totalBytes === 0) {
          $(prefix + '-capacity').removeAttr('aria-valuenow').attr('aria-valuetext', elastic ? 'Elastic capacity' : 'Capacity unavailable');
        } else {
          $(prefix + '-capacity').attr('aria-valuenow', usage).removeAttr('aria-valuetext');
        }
        for (const [field, bytes] of Object.entries(fields)) {
          $(prefix + '-' + field).text(this.formatBytes(bytes));
        }
        $(prefix + '-status').text('').prop('hidden', true);
      }).fail((_xhr, status) => {
        if (status !== 'abort') this.showError(target);
      }).always(() => {
        this.requests.delete(request);
        $(prefix).attr('aria-busy', 'false');
      });
    }
  }

  showError(target) {
    const prefix = '#metrics-' + target;
    $(prefix + '-local').prop('hidden', false);
    $(prefix + '-elastic').prop('hidden', true);
    $(prefix + '-storage').text('Unavailable');
    $(prefix + '-capacity').prop('hidden', true);
    for (const field of ['media', 'available', 'total']) $(prefix + '-' + field).text('—');
    $(prefix + '-status').text('Unable to load metrics. Try reloading the page.').prop('hidden', false);
  }
}
