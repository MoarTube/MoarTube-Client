class MoarTubeStorageMetrics {
  constructor() {
    this.active = true;
    this.requests = new Set();
    this.refreshInterval = 2;
    this.timer = null;
    $('#metrics-refresh-interval').on('change', (event) => {
      const seconds = Number(event.target.value);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 10) return;
      this.refreshInterval = seconds;
      this.scheduleRefresh();
    });
    const stop = () => {
      this.active = false;
      clearInterval(this.timer);
      this.timer = null;
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
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    clearInterval(this.timer);
    this.timer = this.active ? setInterval(() => this.refresh(), this.refreshInterval * 1000) : null;
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
    const prefixes = ['#metrics-client-gpu'];
    for (const target of ['client', 'node']) {
      for (const suffix of ['', '-cpu', '-memory']) prefixes.push('#metrics-' + target + suffix);
    }
    for (const prefix of prefixes) $(prefix).attr('aria-busy', 'true');
    const render = (data) => {
      const metrics = data?.isError ? null : data?.metrics;
      this.renderGpu(metrics?.client?.gpu ?? { isError: true });
      for (const target of ['client', 'node']) {
        const bundle = metrics?.[target];
        this.renderUsage(target, 'cpu', bundle?.cpu ?? { isError: true });
        this.renderMemory(target, bundle?.memory ?? { isError: true });
        this.renderDisk(target, bundle?.disk ?? { isError: true });
      }
    };
    const request = $.ajax({ url: '/settings/metrics', dataType: 'json', timeout: 120000 });
    this.requests.add(request);
    request.done(render).fail((_xhr, status) => {
      if (status !== 'abort') render(null);
    }).always(() => {
      this.requests.delete(request);
      for (const prefix of prefixes) $(prefix).attr('aria-busy', 'false');
    });
  }

  renderDisk(target, data) {
    const prefix = '#metrics-' + target;
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

  renderGpu(data) {
    const prefix = '#metrics-client-gpu';
    const render = (field, value, usage, contribution = null, appValue = 'unavailable') => {
      $(prefix + '-' + field + '-used').text(value);
      const track = $(prefix + '-' + field + '-capacity');
      if (usage === null) {
        track.css('visibility', 'hidden').removeAttr('aria-valuenow aria-valuetext title');
      } else {
        const app = Number.isFinite(contribution) && contribution >= 0 ? Math.min(usage, contribution) : 0;
        this.renderCapacity(prefix + '-' + field, app, 100 - usage, 100);
        const description = 'System: ' + value + '; MoarTube client: ' + appValue;
        track.css('visibility', 'visible').attr('title', description).attr('aria-valuetext', description);
      }
    };
    const showError = () => {
      for (const field of ['encode', 'decode', 'memory']) render(field, 'Unavailable', null);
    };
    if (data.isError || !data.metrics) {
      showError();
      return;
    }
    const metrics = data.metrics;
    for (const field of ['encode', 'decode']) {
      const usage = metrics[field + 'Percent'];
      if (Number.isFinite(usage) && usage >= 0 && usage <= 100) {
        const contribution = metrics[field === 'encode' ? 'appEncodePercent' : 'appDecodePercent'];
        const valid = Number.isFinite(contribution) && contribution >= 0 && contribution <= 100;
        const app = valid ? Math.min(usage, contribution) : null;
        render(field, usage.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%', usage, app,
          valid ? app.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%' : 'unavailable');
      } else {
        render(field, 'Unavailable', null);
      }
    }
    const used = metrics.memoryUsedBytes;
    const total = metrics.memoryTotalBytes;
    if (Number.isFinite(used) && Number.isFinite(total) && used >= 0 && total >= used) {
      const contribution = metrics.appMemoryBytes;
      const valid = Number.isFinite(contribution) && contribution >= 0;
      render('memory', this.formatBytes(used) + ' / ' + this.formatBytes(total), total > 0 ? used / total * 100 : 0,
        valid ? (total > 0 ? Math.min(used, contribution) / total * 100 : 0) : null,
        valid ? this.formatBytes(contribution) + ' (process allocations)' : 'unavailable');
    } else {
      render('memory', 'Unavailable', null);
    }
  }

  renderUsage(target, kind, data) {
    const prefix = '#metrics-' + target + '-' + kind;
    const showError = () => {
      $(prefix + '-used').text('Unavailable');
      $(prefix + '-capacity').css('visibility', 'hidden').removeAttr('aria-valuenow');
    };
    const used = data.metrics?.usedPercent;
    if (data.isError || !Number.isFinite(used) || used < 0 || used > 100) {
      showError();
      return;
    }
    $(prefix + '-used').text(used.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%');
    const measuredApp = data.metrics.appPercent;
    const hasContribution = Number.isFinite(measuredApp) && measuredApp >= 0 && measuredApp <= 100;
    const app = hasContribution ? Math.min(used, measuredApp) : 0;
    this.renderCapacity(prefix, app, 100 - used, 100);
    const description = 'System: ' + used.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%; MoarTube ' + target + ': ' +
      (hasContribution ? app.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%' : 'unavailable');
    $(prefix + '-capacity').css('visibility', 'visible').attr('title', description).attr('aria-valuetext', description);
  }

  renderMemory(target, data) {
    const prefix = '#metrics-' + target + '-memory';
    const showError = () => {
      for (const field of ['app', 'available', 'total']) $(prefix + '-' + field).text('—');
      $(prefix + '-capacity').prop('hidden', true);
      $(prefix + '-status').text('Unable to load RAM metrics. Try reloading the page.').prop('hidden', false);
    };
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
  }

  showError(target) {
    const prefix = '#metrics-' + target;
    $(prefix + '-local').prop('hidden', false);
    $(prefix + '-capacity').prop('hidden', true);
    for (const field of ['media', 'available', 'total']) $(prefix + '-' + field).text('—');
    $(prefix + '-status').text('Unable to load metrics. Try reloading the page.').prop('hidden', false);
  }
}
