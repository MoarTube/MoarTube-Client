(function () {
  'use strict';
  const key = 'moartube-public-node-url-change';
  let initial;
  try {
    initial = localStorage.getItem(key);
  } catch (_) {
    /* Storage may be disabled. */
  }
  function refreshChangedPage() {
    try {
      if (localStorage.getItem(key) !== initial) window.location.reload();
    } catch (_) {
      /* Storage may be disabled. */
    }
  }
  window.addEventListener('focus', refreshChangedPage);
  window.addEventListener('storage', function (event) {
    if (event.key === key && document.hasFocus()) refreshChangedPage();
  });
  window.MoarTubePublicNodeUrl = {
    build: function (settings) {
      let host = settings.publicNodeAddress.trim();
      if (host.includes(':') && !host.startsWith('[')) host = '[' + host + ']';
      const protocol = settings.publicNodeProtocol;
      const port = Number(settings.publicNodePort);
      const suffix =
        (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443)
          ? ''
          : ':' + port;
      return protocol + '://' + host + suffix;
    },
    changed: function (settings) {
      try {
        initial = JSON.stringify([
          settings.publicNodeProtocol,
          settings.publicNodeAddress,
          settings.publicNodePort,
        ]);
        localStorage.setItem(key, initial);
      } catch (_) {
        /* The current page still refreshes when storage is disabled. */
      }
    },
  };
})();
