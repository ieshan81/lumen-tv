'use strict';
// The phone's touchpad moves a virtual mouse inside the browser page (sent over the DevTools connection, so
// it works whichever window has focus). The real Windows cursor doesn't move, so the page draws its own.

const POINTER_SCRIPT = `(() => {
  if (window.__lumenCursor) return;
  let el = null;
  let hideTimer = 0;
  function make() {
    el = document.createElement('div');
    el.id = '__lumen_cursor';
    el.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;' +
      'background:rgba(255,255,255,.94);border:3px solid #6d5cff;box-shadow:0 2px 14px rgba(0,0,0,.65);' +
      'pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .2s;';
  }
  window.__lumenCursor = (x, y, down) => {
    if (!el) make();
    // elements shown with the Fullscreen API sit above everything, so draw inside them
    const fs = document.fullscreenElement;
    const host = fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'IFRAME' ? fs : document.documentElement;
    if (el.parentNode !== host) host.appendChild(el);
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)' + (down ? ' scale(.65)' : '');
    el.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
  };
})();`;

module.exports = { POINTER_SCRIPT };
