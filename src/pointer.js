'use strict';
// The phone's touchpad moves a virtual mouse inside the browser page (sent over the DevTools connection, so
// it works whichever window has focus). The real Windows cursor doesn't move, so the page draws its own.
//
// The dot lives in the browser's top layer (a manual popover). That layer is drawn above everything,
// including fullscreen players, and ignores page transforms, so the dot is always at the exact spot
// the next click will land even when the page is fitted into the screen frame.

const POINTER_SCRIPT = `(() => {
  if (window.__lumenCursor) return;
  let el = null;
  let hideTimer = 0;
  let stacked = '';
  const topLayer = typeof HTMLElement.prototype.showPopover === 'function';
  function make() {
    el = document.createElement('div');
    el.id = '__lumen_cursor';
    if (topLayer) el.popover = 'manual';
    el.style.cssText = 'position:fixed;inset:auto;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;padding:0;box-sizing:border-box;' +
      'overflow:visible;border-radius:50%;background:rgba(255,255,255,.94);border:3px solid #6d5cff;box-shadow:0 2px 14px rgba(0,0,0,.65);' +
      'pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .2s;';
  }
  window.__lumenCursor = (x, y, down) => {
    if (!el) make();
    const fs = document.fullscreenElement;
    if (topLayer) {
      if (el.parentNode !== document.documentElement) document.documentElement.appendChild(el);
      // Whatever joined the top layer last is drawn last: re-enter after a player goes fullscreen or a dialog opens.
      const now = (fs ? 'f' : '') + document.querySelectorAll(':modal').length;
      try {
        if (now !== stacked && el.matches(':popover-open')) el.hidePopover();
        if (!el.matches(':popover-open')) el.showPopover();
        stacked = now;
      } catch (e) { /* not attachable in this document; the dot is simply not shown */ }
    } else {
      // Older engines: elements shown with the Fullscreen API sit above everything, so draw inside them.
      const host = fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'IFRAME' ? fs : document.documentElement;
      if (el.parentNode !== host) host.appendChild(el);
    }
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)' + (down ? ' scale(.65)' : '');
    el.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
  };
})();`;

module.exports = { POINTER_SCRIPT };
