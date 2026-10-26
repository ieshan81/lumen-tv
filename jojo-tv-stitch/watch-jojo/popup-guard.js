/**
 * Drop-in replacement for Watch JoJo js/popup-guard.js.
 * Blocks window.open and target=_blank on the parent page, and closes any
 * window this page actually opened. Does not sandbox the player iframe.
 * Cross-origin embed ads still live inside the iframe; Lumen's popup-closer
 * is what closes extra Edge windows those ads create.
 */
(function () {
  'use strict';

  const tracked = new Set();
  let armed = false;

  function stubWindow() {
    return {
      closed: false,
      close() { this.closed = true; },
      focus() {},
      blur() {},
      postMessage() {},
      location: {
        href: 'about:blank',
        replace() {},
        assign() {},
        reload() {}
      },
      document: { write() {}, open() {}, close() {} }
    };
  }

  function isWatchStreaming() {
    return !!document.getElementById('playerWrap')?.classList?.contains('is-streaming');
  }

  function closeTracked() {
    for (const win of tracked) {
      try {
        if (win && !win.closed) win.close();
      } catch { /* cross-origin */ }
    }
    tracked.clear();
  }

  function blockedOpen() {
    closeTracked();
    try { window.focus(); } catch { /* ignore */ }
    return stubWindow();
  }

  function installOpenGuard() {
    try {
      Object.defineProperty(window, 'open', {
        configurable: true,
        writable: true,
        value: blockedOpen
      });
    } catch {
      window.open = blockedOpen;
    }
  }

  function eatBlankLink(ev) {
    const node = ev.target;
    if (!node || !node.closest) return;
    const link = node.closest('a[target="_blank"], a[target="_new"], area[target="_blank"]');
    if (!link) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  installOpenGuard();

  setInterval(function () {
    if (window.open !== blockedOpen) installOpenGuard();
    closeTracked();
  }, 400);

  document.addEventListener('click', function (ev) {
    eatBlankLink(ev);
    setTimeout(closeTracked, 0);
    setTimeout(closeTracked, 120);
  }, true);

  document.addEventListener('auxclick', function (ev) {
    if (ev.button !== 1) return;
    const node = ev.target;
    if (node && node.closest && node.closest('a[href], area[href]')) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);

  window.addEventListener('blur', function () {
    setTimeout(function () {
      closeTracked();
      if (!document.hasFocus()) {
        try { window.focus(); } catch { /* ignore */ }
      }
    }, 60);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') closeTracked();
  });

  window.addEventListener('beforeunload', function (e) {
    if (!armed || !isWatchStreaming()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  function armRedirectGuard() { armed = true; }
  function disarmRedirectGuard() { armed = false; }

  if (typeof MutationObserver !== 'undefined') {
    const wrap = document.getElementById('playerWrap');
    if (wrap) {
      const sync = () => {
        if (isWatchStreaming()) armRedirectGuard();
        else disarmRedirectGuard();
      };
      new MutationObserver(sync).observe(wrap, {
        attributes: true,
        attributeFilter: ['class']
      });
      sync();
    }
  }

  window.StreamFlixPopupGuard = {
    closeAll: closeTracked,
    armRedirectGuard,
    disarmRedirectGuard,
    applyToIframe: function (iframe) {
      if (!iframe) return;
      iframe.removeAttribute('sandbox');
      iframe.setAttribute('referrerpolicy', 'origin');
      iframe.setAttribute(
        'allow',
        'autoplay; fullscreen *; encrypted-media; picture-in-picture'
      );
      if (window.StreamFlixAdShield?.applyForUrl) {
        window.StreamFlixAdShield.applyForUrl(iframe);
      }
    }
  };
})();
