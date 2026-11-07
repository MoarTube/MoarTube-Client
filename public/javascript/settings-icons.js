/* global $ */
class MoarTubeNodeIcons {
  constructor(showAlert) {
    this.showAlert = showAlert;
    this.form = document.getElementById('personalize_settings_node_icons_form');
    this.rows = document.getElementById('node-icons-rows');
    this.addButton = document.getElementById('node-icons-add');
    this.empty = document.getElementById('node-icons-empty');
    this.resources = document.getElementById('node-icons-resources');
    this.status = document.getElementById('node-icons-status');
    this.pending = false;
    this.dirty = false;
    this.sequence = 0;
  }

  static samples = ["<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#1778F2\" class=\"bi bi-meta\" viewBox=\"0 0 16 16\"> <path fill-rule=\"evenodd\" d=\"M8.217 5.243C9.145 3.988 10.171 3 11.483 3 13.96 3 16 6.153 16.001 9.907c0 2.29-.986 3.725-2.757 3.725-1.543 0-2.395-.866-3.924-3.424l-.667-1.123-.118-.197a55 55 0 0 0-.53-.877l-1.178 2.08c-1.673 2.925-2.615 3.541-3.923 3.541C1.086 13.632 0 12.217 0 9.973 0 6.388 1.995 3 4.598 3q.477-.001.924.122c.31.086.611.22.913.407.577.359 1.154.915 1.782 1.714m1.516 2.224q-.378-.614-.727-1.133L9 6.326c.845-1.305 1.543-1.954 2.372-1.954 1.723 0 3.102 2.537 3.102 5.653 0 1.188-.39 1.877-1.195 1.877-.773 0-1.142-.51-2.61-2.87zM4.846 4.756c.725.1 1.385.634 2.34 2.001A212 212 0 0 0 5.551 9.3c-1.357 2.126-1.826 2.603-2.581 2.603-.777 0-1.24-.682-1.24-1.9 0-2.602 1.298-5.264 2.846-5.264q.136 0 .27.018Z\"/> </svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#5865F2\" class=\"bi bi-discord\" viewBox=\"0 0 16 16\"><path d=\"M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612\"/></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#000000\" class=\"bi bi-twitter-x\" viewBox=\"0 0 16 16\"><path d=\"M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z\"/></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#1778F2\" class=\"bi bi-facebook\" viewBox=\"0 0 16 16\"><path d=\"M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951\"/></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#0a66c2\" class=\"bi bi-linkedin\" viewBox=\"0 0 16 16\"><path d=\"M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z\"/></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"\" class=\"bi\" viewBox=\"0 0 400 400\"><defs xmlns=\"http://www.w3.org/2000/svg\"><style>.a{fill:none;}.b{fill:#00aeef;}.c{fill:#008ccf;}</style></defs><rect xmlns=\"http://www.w3.org/2000/svg\" class=\"a\" width=\"400\" height=\"400\"></rect><path xmlns=\"http://www.w3.org/2000/svg\" class=\"b\" d=\"M137.5,75a125,125,0,1,0,125,125A125,125,0,0,0,137.5,75Zm0,162.5A37.5,37.5,0,1,1,175,200,37.45,37.45,0,0,1,137.5,237.5Z\"></path><path xmlns=\"http://www.w3.org/2000/svg\" class=\"c\" d=\"M278,168.75c31.76,9.14,69.25,0,69.25,0-10.88,47.5-45.38,77.25-95.13,80.87A124.73,124.73,0,0,1,137.5,325L175,205.81C213.55,83.3,233.31,75,324.73,75H387.5C377,121.25,340.81,156.58,278,168.75Z\"></path></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-link-45deg\" viewBox=\"0 0 16 16\"><path d=\"M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z\"/><path d=\"M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z\"/></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#FF0000\" class=\"bi bi-youtube\" viewBox=\"0 0 16 16\"><path d=\"M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 0 1 1.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.082 2.06l-.008.105-.009.104c-.05.572-.124 1.14-.235 1.558a2.01 2.01 0 0 1-1.415 1.42c-1.16.312-5.569.334-6.18.335h-.142c-.309 0-1.587-.006-2.927-.052l-.17-.006-.087-.004-.171-.007-.171-.007c-1.11-.049-2.167-.128-2.654-.26a2.01 2.01 0 0 1-1.415-1.419c-.111-.417-.185-.986-.235-1.558L.09 9.82l-.008-.104A31 31 0 0 1 0 7.68v-.123c.002-.215.01-.958.064-1.778l.007-.103.003-.052.008-.104.022-.26.01-.104c.048-.519.119-1.023.22-1.402a2.01 2.01 0 0 1 1.415-1.42c.487-.13 1.544-.21 2.654-.26l.17-.007.172-.006.086-.003.171-.007A100 100 0 0 1 7.858 2zM6.4 5.209v4.818l4.157-2.408z\"/></svg>", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"#FF5700\" class=\"bi bi-reddit\" viewBox=\"0 0 16 16\"><path d=\"M6.167 8a.83.83 0 0 0-.83.83c0 .459.372.84.83.831a.831.831 0 0 0 0-1.661m1.843 3.647c.315 0 1.403-.038 1.976-.611a.23.23 0 0 0 0-.306.213.213 0 0 0-.306 0c-.353.363-1.126.487-1.67.487-.545 0-1.308-.124-1.671-.487a.213.213 0 0 0-.306 0 .213.213 0 0 0 0 .306c.564.563 1.652.61 1.977.61zm.992-2.807c0 .458.373.83.831.83s.83-.381.83-.83a.831.831 0 0 0-1.66 0z\"/><path d=\"M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.828-1.165c-.315 0-.602.124-.812.325-.801-.573-1.9-.945-3.121-.993l.534-2.501 1.738.372a.83.83 0 1 0 .83-.869.83.83 0 0 0-.744.468l-1.938-.41a.2.2 0 0 0-.153.028.2.2 0 0 0-.086.134l-.592 2.788c-1.24.038-2.358.41-3.17.992-.21-.2-.496-.324-.81-.324a1.163 1.163 0 0 0-.478 2.224q-.03.17-.029.353c0 1.795 2.091 3.256 4.669 3.256s4.668-1.451 4.668-3.256c0-.114-.01-.238-.029-.353.401-.181.688-.592.688-1.069 0-.65-.525-1.165-1.165-1.165\"/></svg>"];

  start() {
    this.addButton.onclick = () => this.addRow({ url: '', svgGraphic: '' }, true);
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
    for (const entry of nodeSettings.nodeIcons || []) this.addRow(entry);
    this.refresh();
  }

  refresh() {
    const rows = [...this.rows.children];
    this.empty.hidden = rows.length !== 0;
    this.resources.hidden = rows.length === 0;
    this.addButton.disabled = this.pending || rows.length >= 5;
    rows.forEach((row, index) => {
      row.querySelector('[data-label="url"]').textContent = `Icon ${index + 1} URL`;
      row.querySelector('[data-label="svgGraphic"]').textContent =
        `Icon ${index + 1} SVG graphic`;
      row.querySelector('[data-remove]').setAttribute('aria-label', `Remove icon ${index + 1}`);
    });
  }

  addRow(entry, focus = false) {
    if (this.pending || (focus && this.rows.children.length >= 5)) return;
    const row = document.createElement('div');
    row.className = 'row align-items-start mb-3 node-icons-row';
    const id = ++this.sequence;
    for (const key of ['url', 'svgGraphic']) {
      const field = document.createElement('div');
      field.className = key === 'url' ? 'col-12 col-lg-4' : 'col-12 col-lg mt-2 mt-lg-0';
      const label = document.createElement('label');
      label.className = 'form-label';
      label.dataset.label = key;
      const input = document.createElement(key === 'url' ? 'input' : 'textarea');
      input.id = `node-icon-${id}-${key}`;
      label.htmlFor = input.id;
      input.className = 'form-control';
      input.name = key;
      if (key === 'url') {
        input.type = 'url';
        input.maxLength = 2048;
        input.placeholder = 'https://rivet.tube';
      } else {
        input.rows = 2;
        input.maxLength = 50000;
        input.placeholder = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">...</svg>';
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
    const preview = document.createElement('img');
    preview.width = 16;
    preview.height = 16;
    preview.alt = 'Icon preview';
    const graphic = row.querySelector('textarea');
    const updatePreview = () => {
      preview.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(graphic.value);
      preview.hidden = !graphic.value.trim();
    };
    graphic.addEventListener('input', updatePreview);
    updatePreview();
    const samples = document.createElement('div');
    samples.className = 'd-flex flex-wrap align-items-center gap-2 mt-2';
    samples.append(preview);
    for (const [index, svg] of MoarTubeNodeIcons.samples.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline-secondary btn-sm mb-0 p-2';
      button.setAttribute('aria-label', `Use sample icon ${index + 1}`);
      const image = document.createElement('img');
      image.width = 16;
      image.height = 16;
      image.alt = '';
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      button.append(image);
      button.onclick = () => {
        if (this.pending) return;
        graphic.value = svg;
        this.dirty = true;
        this.status.textContent = '';
        updatePreview();
        graphic.focus();
      };
      samples.append(button);
    }
    row.querySelector('textarea').closest('.col-12').append(samples);
    const actions = document.createElement('div');
    actions.className = 'col-12 col-lg-auto mt-2 mt-lg-0 align-self-end';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.remove = '';
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
    const nodeIcons = [];
    for (const [index, row] of [...this.rows.children].entries()) {
      const input = row.querySelector('input');
      const svgGraphicInput = row.querySelector('textarea');
      const url = input.value.trim();
      const svgGraphic = svgGraphicInput.value.trim();
      if (url === '' && svgGraphic === '') continue;
      let validUrl = false;
      try {
        const parsed = new URL(url);
        validUrl =
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
      } catch {
        /* Invalid URLs are reported below without losing the draft. */
      }
      if (!validUrl || url.length > 2048 || svgGraphic === '' || svgGraphic.length > 5000) {
        (!validUrl || url.length > 2048 ? input : svgGraphicInput).focus();
        this.showAlert(
          true,
          `Icon ${index + 1} needs an http:// or https:// URL (up to 2048 characters) and an SVG graphic (1 to 50000 characters).`
        );
        return;
      }
      const doc = new DOMParser().parseFromString(svgGraphic, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg' ||
          (doc.documentElement.namespaceURI && doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg')) {
        svgGraphicInput.focus();
        this.showAlert(true, `Icon ${index + 1} needs a valid SVG graphic.`);
        return;
      }
      const svg = doc.documentElement;
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      if (!svg.hasAttribute('fill')) svg.setAttribute('fill', 'currentColor');
      nodeIcons.push({ url, svgGraphic: svg.outerHTML });
    }
    if (nodeIcons.length > 5) {
      this.showAlert(true, 'Use up to 5 icons');
      return;
    }
    this.pending = true;
    this.form.setAttribute('aria-busy', 'true');
    this.form.querySelector('fieldset').disabled = true;
    this.status.textContent = 'Saving icons...';
    try {
      const result = await $.ajax({
        type: 'POST',
        url: this.form.action,
        data: JSON.stringify({ nodeIcons }),
        contentType: 'application/json; charset=utf-8',
        timeout: 30000,
      });
      if (result?.isError !== false)
        throw new Error(result?.message || 'Unable to save icons.');
      this.pending = false;
      this.dirty = false;
      this.load({ nodeIcons });
      this.status.textContent = '';
      this.showAlert(false);
    } catch (error) {
      this.status.textContent =
        'Icons were not confirmed saved. Your entries are still here; try again.';
      this.showAlert(
        true,
        error.responseJSON?.message ||
          error.message ||
          'Unable to save icons. Please try again.'
      );
    } finally {
      this.pending = false;
      this.form.removeAttribute('aria-busy');
      this.form.querySelector('fieldset').disabled = false;
      this.refresh();
    }
  }
}
