/* Favorites are persisted only by the explicit Save favorite action. */
(() => {
  const storageKey = 'moartube.nodeFavorites.v1';
  const fields = {
    username: 'Username',
    password: 'Password',
    moarTubeNodeIp: 'IP address',
    moarTubeNodePort: 'Port',
  };

  $(document).ready(() => {
    const loginForm = document.getElementById('sign-in-form');
    const editor = document.getElementById('node-favorite-editor');
    const nameInput = document.getElementById('node-favorite-name');
    const list = document.getElementById('node-favorites-list');
    const dropdown = document.getElementById('node-favorites-dropdown');
    const summary = document.getElementById('node-favorites-summary');
    const status = document.getElementById('node-favorites-status');
    const choices = document.getElementById('node-favorite-fields');
    let selectedId = null;
    let favorites = [];
    let storageAvailable = true;

    const addressRow = document.createElement('div');
    addressRow.className = 'signin-address-row';
    for (const [key, label] of Object.entries(fields)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'mb-3';
      const input = document.createElement('input');
      input.type = key === 'password' ? 'password' : 'text';
      input.id = `favorite-value-${key}`;
      input.className = 'form-control form-control-lg';
      input.placeholder = label;
      input.setAttribute('aria-label', label);
      input.autocomplete = 'off';
      const fieldLabel = document.createElement('label');
      fieldLabel.htmlFor = input.id;
      fieldLabel.textContent = key === 'moarTubeNodeIp' ? 'Node address' : label;
      wrapper.append(fieldLabel, input);
      if (key === 'moarTubeNodeIp' || key === 'moarTubeNodePort') {
        addressRow.append(wrapper);
      } else {
        choices.append(wrapper);
      }
    }
    choices.append(addressRow);

    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (
        !Array.isArray(stored) ||
        stored.some(
          (favorite) =>
            !favorite ||
            typeof favorite.id !== 'string' ||
            typeof favorite.name !== 'string' ||
            !favorite.name.trim() ||
            Object.keys(fields).some(
              (key) => favorite[key] !== undefined && typeof favorite[key] !== 'string'
            )
        ) ||
        new Set(stored.map((favorite) => favorite.id)).size !== stored.length
      ) {
        throw new Error('Invalid favorites');
      }
      favorites = stored;
    } catch {
      storageAvailable = false;
      status.textContent =
        'Favorites could not be read. Browser storage may be unavailable or damaged. Sign-in is still available.';
    }

    function persist(next) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        favorites = next;
        render();
        return true;
      } catch {
        status.textContent =
          'Could not save favorites. Check that browser storage is available and try again.';
        return false;
      }
    }

    function fillLogin(favorite) {
      // Never combine a partial favorite with another node's credentials.
      for (const key of Object.keys(fields)) {
        loginForm.elements.namedItem(key).value = favorite[key] || '';
      }
    }

    function openEditor() {
      nameInput.value = '';
      for (const key of Object.keys(fields)) {
        document.getElementById(`favorite-value-${key}`).value =
          loginForm.elements.namedItem(key).value;
      }
      loginForm.hidden = true;
      document.getElementById('sign-in-header').hidden = true;
      dropdown.hidden = true;
      dropdown.open = false;
      document.getElementById('node-favorite-header').hidden = false;
      document.getElementById('new-node-favorite').hidden = true;
      editor.hidden = false;
      nameInput.focus();
      status.textContent = '';
    }

    function closeEditor() {
      editor.reset();
      editor.hidden = true;
      loginForm.hidden = false;
      document.getElementById('sign-in-header').hidden = false;
      document.getElementById('node-favorite-header').hidden = true;
      document.getElementById('new-node-favorite').hidden = false;
      dropdown.hidden = favorites.length === 0;
    }

    function button(label, action, className) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = className;
      element.textContent = label;
      element.addEventListener('click', action);
      return element;
    }

    function render() {
      list.replaceChildren();
      dropdown.hidden = favorites.length === 0 || !editor.hidden;
      for (const favorite of favorites) {
        const row = document.createElement('li');
        row.className = 'd-flex gap-2 mb-2';
        row.append(
          button(
            favorite.name,
            () => {
              closeEditor();
              fillLogin(favorite);
              selectedId = favorite.id;
              summary.textContent = `${favorite.name} ▾`;
              dropdown.open = false;
              const missing = Object.keys(fields).filter((key) => !favorite[key]);
              if (missing.length) {
                status.textContent = `Enter ${missing.map((key) => fields[key]).join(', ')} to sign in. These values will not be saved automatically.`;
                loginForm.elements.namedItem(missing[0]).focus();
              } else {
                document.getElementById('sign-in-button').focus();
              }
            },
            'btn btn-lg btn-outline-primary flex-grow-1 mb-0 text-break'
          )
        );
        const remove = button(
          'X',
          () => {
            if (persist(favorites.filter((item) => item.id !== favorite.id))) {
              if (selectedId === favorite.id) {
                fillLogin({});
                selectedId = null;
                summary.textContent = 'Favorites ▾';
              }
              status.textContent = 'Favorite removed.';
              if (favorites.length) summary.focus();
              else document.getElementById('new-node-favorite').focus();
            }
          },
          'btn btn-lg btn-outline-primary mb-0'
        );
        remove.setAttribute('aria-label', `Remove ${favorite.name}`);
        row.append(remove);
        list.append(row);
      }
    }

    document.getElementById('new-node-favorite').disabled = !storageAvailable;
    document.getElementById('new-node-favorite').addEventListener('click', openEditor);
    document.getElementById('cancel-node-favorite').addEventListener('click', closeEditor);
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const favorite = {
        id: Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
        name,
      };
      for (const key of Object.keys(fields)) {
        favorite[key] = document.getElementById(`favorite-value-${key}`).value;
      }
      const next = [...favorites, favorite];
      if (persist(next)) {
        closeEditor();
        status.textContent = 'Favorite saved.';
      }
    });
    render();
  });
})();
