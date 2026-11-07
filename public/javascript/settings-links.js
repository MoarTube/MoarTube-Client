/* global $ */
class MoarTubeNodeLinks {
  constructor(showAlert) {
    this.showAlert = showAlert;
    this.form = document.getElementById('personalize_settings_node_links_form');
    this.rows = document.getElementById('node-links-rows');
    this.addButton = document.getElementById('node-links-add');
    this.empty = document.getElementById('node-links-empty');
    this.status = document.getElementById('node-links-status');
    this.pending = false;
    this.dirty = false;
    this.sequence = 0;
  }

  start() {
    this.addButton.onclick = () => this.addRow({ url: '', description: '' }, true);
    this.form.oninput = () => {
      this.dirty = true;
      this.status.textContent = '';
    };
    this.form.onsubmit = (event) => {
      event.preventDefault();
      void this.save();
    };
  }

  load(nodeSettings) {
    if (this.dirty || this.pending) return;
    this.rows.replaceChildren();
    for (const entry of nodeSettings.nodeLinks || []) this.addRow(entry);
    this.refresh();
  }

  refresh() {
    const rows = [...this.rows.children];
    this.empty.hidden = rows.length !== 0;
    this.addButton.disabled = this.pending || rows.length >= 10;
    rows.forEach((row, index) => {
      row.querySelector('[data-label="url"]').textContent = `Link ${index + 1} URL`;
      row.querySelector('[data-label="description"]').textContent =
        `Link ${index + 1} description`;
      row.querySelector('button').setAttribute('aria-label', `Remove link ${index + 1}`);
    });
  }

  addRow(entry, focus = false) {
    if (this.pending || (focus && this.rows.children.length >= 10)) return;
    const row = document.createElement('div');
    row.className = 'row align-items-start mb-3 node-links-row';
    const id = ++this.sequence;
    for (const key of ['url', 'description']) {
      const field = document.createElement('div');
      field.className = key === 'url' ? 'col-12 col-lg-4' : 'col-12 col-lg mt-2 mt-lg-0';
      const label = document.createElement('label');
      label.className = 'form-label';
      label.dataset.label = key;
      const input = document.createElement(key === 'url' ? 'input' : 'textarea');
      input.id = `node-link-${id}-${key}`;
      label.htmlFor = input.id;
      input.className = 'form-control';
      input.name = key;
      if (key === 'url') {
        input.type = 'url';
        input.maxLength = 2048;
        input.placeholder = 'https://rivet.tube';
      } else {
        input.rows = 2;
        input.maxLength = 1000;
        input.placeholder = 'Indie film, animation, and art';
      }
      input.value = entry[key];
      input.onfocus = () => input.parentElement.classList.add('is-focused');
      input.onblur = () => input.parentElement.classList.remove('is-focused');
      const group = document.createElement('div');
      group.className = 'input-group';
      group.append(input);
      field.append(label, group);
      row.append(field);
    }
    const actions = document.createElement('div');
    actions.className = 'col-12 col-lg-auto mt-2 mt-lg-0 align-self-end';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-outline-secondary btn-sm mb-0';
    remove.textContent = 'Remove';
    remove.onclick = () => {
      if (this.pending) return;
      const target = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      this.dirty = true;
      this.status.textContent = '';
      this.refresh();
      (target?.querySelector('input') || this.addButton).focus();
    };
    actions.append(remove);
    row.append(actions);
    this.rows.append(row);
    this.refresh();
    if (focus) {
      this.dirty = true;
      this.status.textContent = '';
      row.querySelector('input').focus();
    }
  }

  async save() {
    if (this.pending) return;
    const nodeLinks = [];
    for (const [index, row] of [...this.rows.children].entries()) {
      const input = row.querySelector('input');
      const descriptionInput = row.querySelector('textarea');
      const url = input.value.trim();
      const description = descriptionInput.value.trim();
      if (url === '' && description === '') continue;
      let validUrl = false;
      try {
        const parsed = new URL(url);
        validUrl =
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
      } catch {
        /* Invalid URLs are reported below without losing the draft. */
      }
      if (!validUrl || url.length > 2048 || description === '' || description.length > 1000) {
        (!validUrl || url.length > 2048 ? input : descriptionInput).focus();
        this.showAlert(
          true,
          `Link ${index + 1} needs an http:// or https:// URL (up to 2048 characters) and a description (1 to 1000 characters).`
        );
        return;
      }
      nodeLinks.push({ url, description });
    }
    if (nodeLinks.length > 10) {
      this.showAlert(true, 'Use up to 10 links');
      return;
    }
    this.pending = true;
    this.form.setAttribute('aria-busy', 'true');
    this.form.querySelector('fieldset').disabled = true;
    this.status.textContent = 'Saving links...';
    try {
      const result = await $.ajax({
        type: 'POST',
        url: this.form.action,
        data: JSON.stringify({ nodeLinks }),
        contentType: 'application/json; charset=utf-8',
        timeout: 30000,
      });
      if (result?.isError !== false)
        throw new Error(result?.message || 'Unable to save links.');
      this.pending = false;
      this.dirty = false;
      this.load({ nodeLinks });
      this.status.textContent = '';
      this.showAlert(false);
    } catch (error) {
      this.status.textContent =
        'Links were not confirmed saved. Your entries are still here; try again.';
      this.showAlert(
        true,
        error.responseJSON?.message ||
          error.message ||
          'Unable to save links. Please try again.'
      );
    } finally {
      this.pending = false;
      this.form.removeAttribute('aria-busy');
      this.form.querySelector('fieldset').disabled = false;
      this.refresh();
    }
  }
}
