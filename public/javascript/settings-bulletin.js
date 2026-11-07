/* global $ */
class MoarTubeNodeBulletin {
  constructor(showAlert) {
    this.showAlert = showAlert;
    this.form = document.getElementById('personalize_settings_node_bulletin_form');
    this.rows = document.getElementById('node-bulletin-rows');
    this.addButton = document.getElementById('node-bulletin-add');
    this.empty = document.getElementById('node-bulletin-empty');
    this.status = document.getElementById('node-bulletin-status');
    this.pending = false;
    this.dirty = false;
    this.sequence = 0;
  }

  start() {
    this.addButton.onclick = () => this.addRow('', true);
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
    // Other settings refreshes must not discard an unsaved bulletin draft.
    if (this.dirty || this.pending) return;
    this.rows.replaceChildren();
    for (const entry of nodeSettings.nodeBulletin || []) this.addRow(entry);
    this.refresh();
  }

  refresh() {
    const rows = [...this.rows.children];
    this.empty.hidden = rows.length !== 0;
    this.addButton.disabled = this.pending || rows.length >= 10;
    rows.forEach((row, index) => {
      row.querySelector('label').textContent = `Bulletin item ${index + 1}`;
      row.querySelector('button').setAttribute('aria-label', `Remove bulletin item ${index + 1}`);
    });
  }

  addRow(value, focus = false) {
    if (this.pending || (focus && this.rows.children.length >= 10)) return;
    const row = document.createElement('div');
    row.className = 'row align-items-end mb-3 node-bulletin-row';
    const field = document.createElement('div');
    field.className = 'col-12 col-sm';
    const label = document.createElement('label');
    label.className = 'form-label';
    const input = document.createElement('textarea');
    input.id = `node-bulletin-item-${++this.sequence}`;
    label.htmlFor = input.id;
    input.className = 'form-control';
    input.name = 'nodeBulletin';
    input.rows = 2;
    input.maxLength = 1000;
    input.placeholder = 'Bulletin item';
    input.value = value;
    input.onfocus = () => input.parentElement.classList.add('is-focused');
    input.onblur = () => input.parentElement.classList.remove('is-focused');
    const group = document.createElement('div');
    group.className = 'input-group';
    group.append(input);
    field.append(label, group);
    const actions = document.createElement('div');
    actions.className = 'col-12 col-sm-auto mt-2 mt-sm-0';
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
      (target?.querySelector('textarea') || this.addButton).focus();
    };
    actions.append(remove);
    row.append(field, actions);
    this.rows.append(row);
    this.refresh();
    if (focus) {
      this.dirty = true;
      this.status.textContent = '';
      input.focus();
    }
  }

  async save() {
    if (this.pending) return;
    // Unused blank draft rows do not become empty bulletin items.
    const nodeBulletin = [...this.rows.querySelectorAll('textarea')]
      .map((input) => input.value.trim())
      .filter(Boolean);
    if (nodeBulletin.length > 10 || nodeBulletin.some((entry) => entry.length > 1000)) {
      this.showAlert(true, 'Use up to 10 bulletin items, each with 1 to 1000 characters');
      return;
    }
    this.pending = true;
    this.form.setAttribute('aria-busy', 'true');
    this.form.querySelector('fieldset').disabled = true;
    this.status.textContent = 'Saving bulletin…';
    try {
      const result = await $.ajax({
        type: 'POST',
        url: this.form.action,
        data: JSON.stringify({ nodeBulletin }),
        contentType: 'application/json; charset=utf-8',
        timeout: 30000,
      });
      if (result?.isError !== false) throw new Error(result?.message || 'Unable to save bulletin.');
      this.pending = false;
      this.dirty = false;
      this.load({ nodeBulletin });
      this.status.textContent = '';
      this.showAlert(false);
    } catch (error) {
      this.status.textContent =
        'Bulletin was not confirmed saved. Your entries are still here; try again.';
      this.showAlert(
        true,
        error.responseJSON?.message || error.message || 'Unable to save bulletin. Please try again.'
      );
    } finally {
      this.pending = false;
      this.form.removeAttribute('aria-busy');
      this.form.querySelector('fieldset').disabled = false;
      this.refresh();
    }
  }
}
