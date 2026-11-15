'use strict';
// Fits a website inside the calibrated screen frame (the four Halo corners).
//
// The page still believes it owns the whole projector: <html> is warped onto the frame with a
// homography, <body> becomes the scroller (a transformed root cannot scroll the viewport and keep
// fixed headers in place), and anything shown with the Fullscreen API is scaled into the frame as
// well, because the browser draws fullscreen elements above the page and ignores page transforms.
//
// Serialized into the page. It runs when a document is created, before <html> exists, so the rules
// live in a constructed stylesheet: that needs no element to attach to, applies from the first
// paint, survives sites that rewrite their <head>, and is not subject to a site's style CSP.
function installProjectorLayout(points) {
  // Frames inside the page are carried along by their <iframe>; fitting them again would shrink them twice.
  if (window.top !== window) return;
  const state = window.__lumenProjector || (window.__lumenProjector = { active: false, points: null });
  state.points = Array.isArray(points) && points.length === 4 ? points : null;
  state.active = !!state.points;
  document.getElementById('lumen-projector-layout')?.remove(); // style element left by an older Lumen

  if (!state.installed) {
    state.installed = true;
    state.sheet = new CSSStyleSheet();
    state.page = new CSSStyleSheet();
    const scroller = () => (state.active && document.body) || null;

    // Scripts that scroll or measure "the window" are pointed at the body, which now does the scrolling.
    for (const name of ['scrollTo', 'scroll', 'scrollBy']) {
      const native = window[name];
      window[name] = function (...args) { const el = scroller(); return el ? el[name](...args) : native.apply(window, args); };
    }
    for (const [name, property] of [['scrollX', 'scrollLeft'], ['pageXOffset', 'scrollLeft'], ['scrollY', 'scrollTop'], ['pageYOffset', 'scrollTop']]) {
      const native = Object.getOwnPropertyDescriptor(window, name);
      if (!native || !native.get) continue;
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get() { const el = scroller(); return el ? el[property] : native.get.call(window); }, set() {} });
    }
    const scrolling = Object.getOwnPropertyDescriptor(Document.prototype, 'scrollingElement');
    if (scrolling && scrolling.get) Object.defineProperty(document, 'scrollingElement', { configurable: true, get() { return scroller() || scrolling.get.call(document); } });
    const relay = () => { if (state.active) document.dispatchEvent(new Event('scroll', { bubbles: true })); };

    state.ensure = () => {
      for (const sheet of [state.sheet, state.page]) {
        if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      const root = document.documentElement, body = document.body;
      if (root && root !== state.root) {
        state.root = root;
        for (const name of ['scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth']) {
          const native = Object.getOwnPropertyDescriptor(Element.prototype, name);
          if (!native || !native.get) continue;
          Object.defineProperty(root, name, {
            configurable: true,
            get() { const el = scroller(); return el ? el[name] : native.get.call(this); },
            set(value) { const el = scroller(); if (el) el[name] = value; else if (native.set) native.set.call(this, value); }
          });
        }
        for (const name of ['scrollTo', 'scroll', 'scrollBy']) {
          const native = root[name];
          root[name] = function (...args) { const el = scroller(); return el ? el[name](...args) : native.apply(this, args); };
        }
      }
      if (body && body !== state.body) {
        state.body = body;
        body.addEventListener('scroll', relay, { passive: true });
      }
    };

    const rules = () => {
      const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
      const p = state.points.map(point => ({ x: point.x * w, y: point.y * h })), [p0, p1, p2, p3] = p;
      const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
      const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
      const denominator = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(denominator) < 1e-8) return '';
      const g = (dx3 * dy2 - dx2 * dy3) / denominator, k = (dx1 * dy3 - dx3 * dy1) / denominator;
      const matrix = [
        (p1.x - p0.x + g * p1.x) / w, (p1.y - p0.y + g * p1.y) / w, 0, g / w,
        (p3.x - p0.x + k * p3.x) / h, (p3.y - p0.y + k * p3.y) / h, 0, k / h,
        0, 0, 1, 0, p0.x, p0.y, 0, 1
      ].map(value => Number(value.toFixed(10))).join(',');
      const xs = p.map(point => point.x), ys = p.map(point => point.y);
      const left = Math.min(...xs), top = Math.min(...ys);
      const scaleX = (Math.max(...xs) - left) / w, scaleY = (Math.max(...ys) - top) / h;
      return [
        // The black root background also fills everything outside the frame, so the Halo samples a clean picture.
        'html{background:#000!important;overflow:hidden!important;width:100vw!important;height:100vh!important;min-width:0!important;min-height:0!important;' +
          'max-width:none!important;max-height:none!important;margin:0!important;transform-origin:0 0!important;transform:matrix3d(' + matrix + ')!important;' +
          'translate:none!important;scale:none!important;rotate:none!important;clip-path:inset(0)!important}',
        // Scrolling stays overridable so a site can still lock the page behind its own dialog.
        'body{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;' +
          'margin:0!important;overflow-x:hidden;overflow-y:auto;scrollbar-width:none}',
        // The browser forbids `transform` on a fullscreen element, but not the separate translate and scale properties.
        ':not(:root):fullscreen{transform-origin:0 0!important;translate:' + left.toFixed(2) + 'px ' + top.toFixed(2) + 'px!important;' +
          'scale:' + scaleX.toFixed(6) + ' ' + scaleY.toFixed(6) + '!important;rotate:none!important}'
      ].join('\n');
    };

    state.apply = () => {
      state.ensure();
      state.sheet.replaceSync(state.active ? rules() : '');
      if (!state.active) state.page.replaceSync('');
      else state.measure();
    };

    // The root background is replaced with black, which would also swallow a page colour set on <html>
    // (or the default white page). Hand that colour to the body unless the site paints the body itself.
    state.measure = () => {
      const root = document.documentElement;
      if (!state.active || !root || !document.body) return;
      state.sheet.disabled = true;
      const own = getComputedStyle(root).backgroundColor;
      state.sheet.disabled = false;
      const none = !own || own === 'transparent' || /,\s*0\)$/.test(own);
      state.page.replaceSync(':where(body){background-color:' + (none ? 'Canvas' : own) + '}');
    };

    addEventListener('resize', () => state.apply(), { passive: true });
    document.addEventListener('DOMContentLoaded', () => state.apply());
    addEventListener('load', () => state.apply());
    // Sites replace <body>, or reassign their adopted stylesheets, without telling anyone.
    setInterval(() => state.ensure(), 2000);

    // With nothing focused, the browser sends keyboard scrolling to the window, which no longer scrolls.
    addEventListener('keydown', event => {
      const el = scroller();
      if (!el || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      if (el.scrollHeight <= el.clientHeight + 1) return;
      const page = el.clientHeight * .85;
      const amounts = { PageDown: page, PageUp: -page, ' ': event.shiftKey ? -page : page, ArrowDown: 90, ArrowUp: -90, Home: -el.scrollHeight, End: el.scrollHeight };
      const amount = amounts[event.key];
      if (!amount) return;
      event.preventDefault();
      el.scrollBy({ top: amount, behavior: 'smooth' });
    });
  }
  state.apply();
}

function projectorLayoutScript(layout) {
  const points = layout?.enabled && Array.isArray(layout.points) && layout.points.length === 4
    ? layout.points.map(point => ({ x: Number(point.x), y: Number(point.y) }))
    : null;
  return `(${installProjectorLayout.toString()})(${JSON.stringify(points)})`;
}

/** The frame's bounding box inside a w×h viewport: where the pointer may travel and where fullscreen lands. */
function layoutBox(layout, width, height) {
  const points = layout?.enabled && Array.isArray(layout.points) && layout.points.length === 4 ? layout.points : null;
  if (!points) return { left: 0, top: 0, right: width, bottom: height };
  const xs = points.map(point => point.x * width), ys = points.map(point => point.y * height);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

module.exports = { projectorLayoutScript, layoutBox };
