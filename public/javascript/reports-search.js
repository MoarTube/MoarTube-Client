class MoarTubeReportsSearch {
  constructor({ loadReports, loadArchives, onError }) {
    this.input = document.getElementById('search-input');
    this.form = this.input.form;
    this.icon = document.getElementById('search_input_icon');
    this.spinner = document.getElementById('search_input_spinner');
    this.loadReports = loadReports;
    this.loadArchives = loadArchives;
    this.onError = onError;
    this.basePath = location.pathname.replace(/\/$/, '');
    this.generation = 0;
    this.active = true;
    this.timer = null;
    this.controller = null;
    this.input.addEventListener('input', (event) => this.schedule(event.isComposing));
    this.input.addEventListener('compositionend', () => this.schedule(false));
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.search();
    });
    for (const label of ['Report pages', 'Archive pages']) {
      document.querySelector('nav[aria-label="' + label + '"]').addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        this.load(new URL(link.href), 'pushState');
      });
    }
    window.addEventListener('popstate', () => {
      this.input.value = new URL(location.href).searchParams.get('search') || '';
      this.load(new URL(location.href));
    });
    window.addEventListener('pagehide', () => {
      this.active = false;
      this.cancel();
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.active = true;
        this.input.value = new URL(location.href).searchParams.get('search') || '';
        this.load(new URL(location.href));
      }
    });
  }

  setBusy(busy) {
    this.icon.classList.toggle('hidden-elem', busy);
    this.spinner.classList.toggle('hidden-elem', !busy);
    this.form.setAttribute('aria-busy', String(busy));
  }

  cancel() {
    clearTimeout(this.timer);
    this.generation++;
    this.controller?.abort();
  }

  schedule(composing) {
    this.cancel();
    this.setBusy(true);
    if (!composing) this.timer = setTimeout(() => this.search(), 500);
  }

  search() {
    const url = new URL(location.href);
    url.searchParams.set('search', this.input.value);
    url.searchParams.delete('page');
    url.searchParams.delete('archivePage');
    this.load(url, 'replaceState');
  }

  pageNumber(url, key) {
    const value = Number(url.searchParams.get(key));
    return Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value : 0;
  }

  async load(url, historyMethod) {
    this.cancel();
    if (!this.active) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.setBusy(true);
    const page = this.pageNumber(url, 'page');
    const archivePage = this.pageNumber(url, 'archivePage');
    const search = url.searchParams.get('search') || '';
    const fetchPage = async (endpoint, offset) => {
      const query = new URLSearchParams({ search, offset: String(offset) });
      const response = await fetch(endpoint + '?' + query, { signal: controller.signal });
      if (!response.ok) throw new Error('Unable to load reports');
      const data = await response.json();
      if (data.isError || !Array.isArray(data.reports)) throw new Error('Unable to load reports');
      return data;
    };
    try {
      const [reports, archives] = await Promise.all([
        fetchPage(this.basePath + '/all', page * 100),
        fetchPage(this.basePath + '/archive/all', archivePage * 100),
      ]);
      if (!this.active || generation !== this.generation) return;
      this.loadReports(reports.reports);
      this.loadArchives(archives.reports);
      this.renderPages('Report pages', url, 'page', page, reports.hasMore, 'reports');
      this.renderPages('Archive pages', url, 'archivePage', archivePage, archives.hasMore, 'archives');
      if (historyMethod) history[historyMethod](history.state, '', url.pathname + url.search + url.hash);
    } catch (error) {
      if (this.active && generation === this.generation && error.name !== 'AbortError') {
        controller.abort();
        this.onError('Unable to load reports. Please try again.');
      }
    } finally {
      if (generation === this.generation) {
        this.controller = null;
        this.setBusy(false);
      }
    }
  }

  renderPages(label, url, key, page, hasMore, noun) {
    const nav = document.querySelector('nav[aria-label="' + label + '"]');
    const link = (number, text) => {
      const target = new URL(url);
      target.searchParams.set(key, number);
      const anchor = document.createElement('a');
      anchor.href = target.pathname + target.search;
      anchor.textContent = text;
      return anchor;
    };
    const current = document.createElement('span');
    current.textContent = 'Page ' + (page + 1);
    nav.replaceChildren();
    if (page > 0) nav.append(link(page - 1, 'Previous ' + noun));
    nav.append(current);
    if (hasMore) nav.append(link(page + 1, 'Next ' + noun));
  }
}
