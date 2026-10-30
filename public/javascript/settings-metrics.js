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
      this.loadMemory(target);
      const prefix = '#metrics-' + target;
      $(prefix).attr('aria-busy', 'true');
      $(prefix + '-status').text('Calculating...').prop('hidden', false);
      const request = $.ajax({ url: '/settings/metrics/' + target + '/disk', dataType: 'json', timeout: 120000 });
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
        this.renderCapacity(prefix, metrics.mediaBytes, metrics.availableBytes, metrics.totalBytes, elastic);
        for (const [field, bytes] of Object.entries(fields)) {
          $(prefix + '-' + field).text(elastic ? '∞' : this.formatBytes(bytes));
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

  renderCapacity(prefix, appBytes, availableBytes, totalBytes, elastic = false) {
    const total = elastic ? 0 : totalBytes;
    const app = Math.min(total, elastic ? 0 : appBytes);
    const occupied = Math.min(total, Math.max(app, total - availableBytes));
    const usage = total > 0 ? occupied / total * 100 : 0;
    const appShare = occupied > 0 ? app / occupied * 100 : 0;
    $(prefix + '-capacity').prop('hidden', false);
    $(prefix + '-occupied').css({ width: usage + '%', minWidth: app > 0 ? '3px' : '0' });
    $(prefix + '-usage-bar').css({ width: appShare + '%', minWidth: app > 0 ? '3px' : '0' });
    if (elastic || total === 0) {
      $(prefix + '-capacity').removeAttr('aria-valuenow').attr('aria-valuetext', elastic ? 'Elastic capacity' : 'Capacity unavailable');
    } else {
      $(prefix + '-capacity').attr('aria-valuenow', usage).removeAttr('aria-valuetext');
    }
  }

  loadMemory(target) {
    const prefix = '#metrics-' + target + '-memory';
    const showError = () => {
      for (const field of ['app', 'available', 'total']) $(prefix + '-' + field).text('—');
      $(prefix + '-capacity').prop('hidden', true);
      $(prefix + '-status').text('Unable to load RAM metrics. Try reloading the page.').prop('hidden', false);
    };
    const request = $.ajax({ url: '/settings/metrics/' + target + '/memory', dataType: 'json', timeout: 20000 });
    this.requests.add(request);
    request.done((data) => {
      const memory = data.metrics;
      if (data.isError || !memory || [memory.appBytes, memory.availableBytes, memory.totalBytes].some(value => !Number.isFinite(value) || value < 0)) {
        showError();
        return;
      }
      for (const [field, bytes] of Object.entries({ app: memory.appBytes, available: memory.availableBytes, total: memory.totalBytes })) {
        $(prefix + '-' + field).text(this.formatBytes(bytes));
      }
      this.renderCapacity(prefix, memory.appBytes, memory.availableBytes, memory.totalBytes);
      $(prefix + '-status').text('').prop('hidden', true);
    }).fail((_xhr, status) => {
      if (status !== 'abort') showError();
    }).always(() => {
      this.requests.delete(request);
      $(prefix).attr('aria-busy', 'false');
    });
  }

  showError(target) {
    const prefix = '#metrics-' + target;
    $(prefix + '-local').prop('hidden', false);
    $(prefix + '-capacity').prop('hidden', true);
    for (const field of ['media', 'available', 'total']) $(prefix + '-' + field).text('—');
    $(prefix + '-status').text('Unable to load metrics. Try reloading the page.').prop('hidden', false);
  }
}
