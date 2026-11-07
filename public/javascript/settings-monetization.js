/* global $ */
class MoarTubeNodeMonetization {
  constructor(showAlert) {
    this.showAlert = showAlert;
    this.form = document.getElementById('personalize_settings_node_monetization_form');
    this.rows = document.getElementById('node-monetization-rows');
    this.status = document.getElementById('node-monetization-status');
    this.empty = document.getElementById('node-monetization-empty');
    this.retry = document.getElementById('node-monetization-retry');
    this.removed = [];
    this.sequence = 0;
    this.pending = false;
    this.base = '/settings/node/personalize/monetization';
  }

  async request(path = '', data) {
    const result = await $.ajax({
      type: data === undefined ? 'GET' : 'POST',
      url: this.base + path,
      data: data === undefined ? undefined : JSON.stringify(data),
      contentType: 'application/json; charset=utf-8',
      timeout: 30000,
    });
    if (result?.isError !== false) throw new Error(result?.message || 'Unable to update donation addresses.');
    return result;
  }

  async start() {
    document.getElementById('node-monetization-add').onclick = () => this.addRow();
    this.form.onsubmit = (event) => { event.preventDefault(); void this.save(); };
    this.retry.onclick = () => void this.load();
    await this.load();
  }

  async load() {
    if (this.pending) return;
    this.pending = true;
    this.retry.hidden = true;
    this.form.setAttribute('aria-busy', 'true');
    this.status.textContent = 'Loading donation addresses...';
    try {
      const result = await this.request();
      if (!Array.isArray(result.cryptoWalletAddresses)) throw new Error('Invalid donation address response.');
      this.rows.replaceChildren();
      this.pending = false;
      for (const entry of result.cryptoWalletAddresses) this.addRow(entry);
      this.form.querySelector('fieldset').disabled = false;
      this.status.textContent = '';
      this.refresh();
    } catch {
      this.status.textContent = 'Unable to load donation addresses. Try again.';
      this.retry.hidden = false;
    } finally {
      this.pending = false;
      this.form.removeAttribute('aria-busy');
    }
  }

  refresh() {
    this.empty.hidden = this.rows.children.length !== 0;
    document.getElementById('node-monetization-add').disabled = this.pending || this.rows.children.length >= 10;
    [...this.rows.children].forEach((row, index) => {
      row.querySelector('button').setAttribute('aria-label', `Remove donation address ${index + 1}`);
    });
  }

  addRow(entry) {
    if (this.pending || (!entry && this.rows.children.length >= 10)) return;
    const row = document.createElement('div');
    row.className = 'row align-items-start mb-3 node-monetization-row';
    row.walletId = entry?.wallet_address_id;
    const id = ++this.sequence;
    for (const [key, title] of [['walletAddress', 'Crypto Wallet Address'], ['chain', 'Chain'], ['currency', 'Currency']]) {
      const field = document.createElement('div');
      field.className = key === 'walletAddress' ? 'col-12 col-lg' : 'col-6 col-lg-2 mt-2 mt-lg-0';
      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = title;
      const input = document.createElement(key === 'walletAddress' ? 'input' : 'select');
      input.id = `donation-${id}-${key}`;
      input.name = key;
      input.className = 'form-control';
      label.htmlFor = input.id;
      if (key === 'walletAddress') {
        input.type = 'text';
        input.maxLength = 1000;
        input.placeholder = '0x...';
        input.value = entry?.wallet_address || '';
        input.readOnly = !!entry;
      } else {
        const choices = key === 'chain' ? ['', 'ETH', 'BNB'] : [''];
        if (entry && !choices.includes(entry[key])) choices.push(entry[key]);
        for (const value of choices) input.add(new Option(value || 'Choose...', value));
        input.value = entry?.[key] || '';
        input.disabled = !!entry || key === 'currency';
      }
      const group = document.createElement('div');
      group.className = 'input-group';
      input.onfocus = () => group.classList.add('is-focused');
      input.onblur = () => group.classList.remove('is-focused');
      group.append(input);
      field.append(label, group);
      row.append(field);
    }
    const chain = row.querySelector('[name=chain]');
    const currency = row.querySelector('[name=currency]');
    chain.onchange = () => {
      currency.replaceChildren(new Option('Choose...', ''));
      if (chain.value) currency.add(new Option(chain.value, chain.value));
      currency.disabled = !chain.value;
    };
    const actions = document.createElement('div');
    actions.className = 'col-12 col-lg-auto mt-2 mt-lg-0 align-self-end';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-outline-secondary btn-sm mb-0';
    remove.textContent = 'Remove';
    remove.onclick = () => {
      if (this.pending) return;
      if (row.walletId) this.removed.push(row.walletId);
      const target = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      this.refresh();
      (target?.querySelector('input') || document.getElementById('node-monetization-add')).focus();
    };
    actions.append(remove);
    row.append(actions);
    this.rows.append(row);
    this.refresh();
    if (!entry) row.querySelector('input').focus();
  }

  async save() {
    if (this.pending) return;
    const drafts = [];
    for (const row of this.rows.children) {
      if (row.walletId) continue;
      const fields = ['walletAddress', 'chain', 'currency'].map((key) => row.querySelector(`[name=${key}]`));
      const [walletAddress, chain, currency] = fields.map((input) => input.value.trim());
      if (!walletAddress && !chain && !currency) continue;
      if (!walletAddress || !['ETH', 'BNB'].includes(chain) || currency !== chain) {
        fields[!walletAddress ? 0 : !chain ? 1 : 2].focus();
        this.showAlert(true, 'Enter a wallet address and matching ETH or BNB chain and currency.');
        return;
      }
      drafts.push({ row, data: { walletAddress, chain, currency } });
    }
    const savedCount = [...this.rows.children].filter((row) => row.walletId).length;
    if (savedCount + drafts.length > 10) {
      this.showAlert(true, 'Use up to 10 donation addresses');
      return;
    }
    this.pending = true;
    this.form.setAttribute('aria-busy', 'true');
    this.form.querySelector('fieldset').disabled = true;
    this.status.textContent = 'Saving donation addresses...';
    try {
      // Remove first so replacements can be saved when already at the address limit.
      while (this.removed.length) {
        await this.request('/delete', { cryptoWalletAddressId: this.removed[0] });
        this.removed.shift();
      }
      // Record each confirmed operation so retrying a partial save does not repeat it.
      for (const { row, data } of drafts) {
        const result = await this.request('/add', data);
        const saved = result.cryptoWalletAddress;
        if (!Number.isInteger(saved?.wallet_address_id) || saved.wallet_address_id <= 0)
          throw new Error('Address was not confirmed saved. Reload to check before trying again.');
        row.walletId = saved.wallet_address_id;
        row.querySelector('input').readOnly = true;
        row.querySelectorAll('select').forEach((select) => { select.disabled = true; });
      }
      this.status.textContent = '';
      this.showAlert(false);
    } catch (error) {
      this.status.textContent = 'Some changes were not confirmed saved. Your remaining changes are still here; check before retrying.';
      this.showAlert(true, error.responseJSON?.message || error.message || 'Unable to save donation addresses.');
    } finally {
      this.pending = false;
      this.form.removeAttribute('aria-busy');
      this.form.querySelector('fieldset').disabled = false;
      this.refresh();
    }
  }
}
