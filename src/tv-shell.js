'use strict';

const { allowedOrigins } = require('./navigation-policy');

const usesTvShell = tile => tile?.tvShell === true || tile?.id === 'jojo';

// A shared TV presentation layer. Never injected into third-party player frames.
function installTvShell(origins) {
  if (window.top !== window || (origins?.length && !origins.includes(location.origin))) return;
  if (window.__lumenShellInstalled) return;
  window.__lumenShellInstalled = true;
  const apply = () => {
    document.documentElement.classList.add('lumen-tv');
    const style = document.createElement('style');
    style.id = 'lumen-unified-shell';
    style.textContent = `
      html.lumen-tv{--tv-bg:#090b11;--tv-fg:#f4f5fa;--tv-muted:#a6adc1;--tv-accent:#a99bff;--tv-focus:#fff;--tv-safe:clamp(24px,3.5vw,64px);color-scheme:dark;scroll-padding:5vh}
      html.lumen-tv body{font-family:Outfit,'Segoe UI',system-ui,sans-serif!important;background:var(--tv-bg);color:var(--tv-fg)}
      html.lumen-tv :is(.navbar,.watch-nav){border-bottom:1px solid #ffffff12;background:#090b11eb;backdrop-filter:blur(18px)}
      html.lumen-tv :is(button,.btn,a[role=button],input,select){border-radius:14px;min-height:48px}
      html.lumen-tv :is(a,button,input,select,textarea,[tabindex]):focus{outline:3px solid white!important;outline-offset:5px;box-shadow:0 0 0 8px #a99bff35!important}
      html.lumen-tv :is(.movie-card,.media-card,.poster-card):focus-within{transform:scale(1.035)}
      html.lumen-tv .media-card>a{display:block;border-radius:12px;scroll-margin:5vh 3vw}
      html.lumen-tv :is(a,button,[tabindex]){scroll-margin:5vh 3vw}
      html.lumen-tv .header-search-cluster{height:auto;min-height:56px}
      html.lumen-tv .header-search-cluster a{min-height:40px;font-size:15px}
      html.lumen-tv .header-search-cluster button{min-width:44px;min-height:40px}
      html.lumen-tv .media-card h3{font-size:clamp(15px,1.15vw,22px);line-height:1.35}
      html.lumen-tv :is(.player-container,.watch-player){border-radius:18px;overflow:hidden;background:#000}
      html.lumen-tv.lumen-cinema :is(.navbar,.watch-nav){backdrop-filter:none}
      html.lumen-tv.lumen-cinema :is(.player-container,.watch-player){border-radius:0}
      html.lumen-tv :is(.watch-title,.series-panel__heading){letter-spacing:-.025em}
      html.lumen-tv :is(.btn-play,.btn-primary){background:#b4a9ff;color:#141020}
      @media(prefers-reduced-motion:reduce){html.lumen-tv *{scroll-behavior:auto!important;transition:none!important}}
    `;
    document.head.appendChild(style);
    const selector = 'a[href],button,input,select,textarea,[tabindex],[role="button"],[role="tab"]';
    function visible(node) {
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      if (node.checkVisibility) return node.checkVisibility({ opacityProperty:true, visibilityProperty:true });
      return getComputedStyle(node).visibility !== 'hidden';
    }
    function scope() {
      return Array.from(document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"],[data-lumen-site-menu="true"]')).filter(visible).at(-1) || document;
    }
    function nodes(root) {
      return Array.from(root.querySelectorAll(selector)).filter(node => {
        if (node.disabled || node.getAttribute('aria-disabled') === 'true' || /^-/.test(node.getAttribute('tabindex') || '') || !visible(node)) return false;
        // Movy's hero buttons are nested in links: one focus stop, not two.
        return !node.parentElement?.closest('a[href],button');
      });
    }
    const memory = new Map();
    let lastScope = document;
    let beforeDialog = null;
    let lastPath = location.pathname + location.search;
    function focus(node) {
      if (!node) return;
      if (node.tabIndex < 0) node.tabIndex = 0;
      node.focus({ preventScroll:true });
      node.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'instant' });
    }
    function ensureFocus() {
      const video = document.querySelector('video');
      const rect = video?.getBoundingClientRect();
      const cinema = !!(rect && rect.width * rect.height > innerWidth * innerHeight * .3 && !video.ended && video.readyState > 0);
      document.documentElement.classList.toggle('lumen-cinema', cinema);
      // Auto-hiding player controls and subtitle mutations must not repeatedly scan/focus
      // the catalog behind the movie. Explicit D-pad navigation and dialogs still work.
      if (cinema && !document.querySelector('dialog[open],[role="dialog"]:not([hidden]),[aria-modal="true"]:not([hidden]),[data-lumen-site-menu="true"]')) return;
      const root = scope();
      let active = document.activeElement;
      const path = location.pathname + location.search;
      const pathChanged = path !== lastPath;
      lastPath = path;
      if (root !== lastScope) {
        if (root !== document && lastScope === document) beforeDialog = active;
        else if (root === document && beforeDialog?.isConnected && visible(beforeDialog)) focus(beforeDialog);
        lastScope = root;
      }
      active = document.activeElement;
      if (!pathChanged && active && active !== document.body && active.isConnected && root.contains(active) && visible(active)) return;
      const choices = nodes(root);
      const saved = memory.get(path);
      const remembered = saved && choices.find(node => saved === (node.id || node.getAttribute('href') || node.getAttribute('aria-label')));
      const onScreen = choices.filter(node => { const r=node.getBoundingClientRect(); return r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth; });
      focus(remembered || onScreen[0] || choices[0]);
    }
    document.addEventListener('focusin', event => {
      const node = event.target;
      if (node.matches('input,textarea,select') || node.isContentEditable) return;
      memory.set(location.pathname + location.search, node.id || node.getAttribute('href') || node.getAttribute('aria-label'));
    });
    let frame = 0;
    const refresh = () => { if (!frame) frame = requestAnimationFrame(() => { frame=0; ensureFocus(); }); };
    new MutationObserver(refresh).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden','inert','aria-hidden','open'] });
    window.addEventListener('popstate', refresh);
    for (const event of ['loadeddata','emptied','ended','playing']) document.addEventListener(event, refresh, true);
    refresh();
    // Back closes local UI before leaving a page. The website keeps ownership of its dialogs.
    window.__lumenTVNavigation = {
      back() {
        const menu=window.__lumenSiteMenu;
        if(menu?.panel?.isConnected&&visible(menu.panel)){menu.close();return true;}
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return true; }
        const search = Array.from(document.querySelectorAll('button[aria-label="Close search"]')).find(visible);
        if (search) { search.click(); return true; }
        if (scope() !== document) return 'escape';
        const active = document.activeElement;
        if (active?.matches('input,textarea') || active?.isContentEditable) { active.blur(); refresh(); return true; }
        return false;
      }
    };
    document.addEventListener('keydown', event => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      const active = document.activeElement;
      if (active?.matches('input,textarea,select,iframe,video') || active?.isContentEditable) return;
      const choices = nodes(scope());
      if (!choices.length) return;
      const rect = active?.getBoundingClientRect();
      const x = rect && rect.width ? rect.left + rect.width / 2 : innerWidth / 2;
      const y = rect && rect.height ? rect.top + rect.height / 2 : 0;
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const positive = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const ranked = choices.filter(node => node !== active).map(node => {
        const r = node.getBoundingClientRect();
        const dx = r.left + r.width / 2 - x;
        const dy = r.top + r.height / 2 - y;
        const primary = horizontal ? dx : dy;
        const cross = horizontal ? dy : dx;
        const overlap = rect && (horizontal ? Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top) : Math.min(rect.right,r.right)-Math.max(rect.left,r.left));
        const direction = positive ? primary > 4 : primary < -4;
        // Left/right stay in the same rail; up/down preserve the horizontal column where possible.
        return { node, allowed: direction && (!horizontal || overlap > 4), score: (Math.abs(primary) + Math.abs(cross) * 2.5) * (overlap > 4 ? .35 : 1) };
      }).filter(item => item.allowed).sort((a,b) => a.score - b.score);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (ranked[0]) focus(ranked[0].node);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once:true });
  else apply();
}

module.exports = {
  usesTvShell,
  tvShellScript: tile => `(${installTvShell.toString()})(${JSON.stringify(allowedOrigins(tile))})`,
  TV_SHELL_JS: `(${installTvShell.toString()})()`
};
