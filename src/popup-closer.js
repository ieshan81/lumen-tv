'use strict';
// Drop-in for Lumen TV. Copy to src/popup-closer.js.
// Armed only when the open tile has blockPopups: true (JoJo and Movy).
// Never closes or injects into Netflix, Prime Video, Disney+, or the other DRM hosts.

const SWEEP_MS = 350;

const PROTECTED_HOSTS = /(^|\.)(netflix|primevideo|amazon|disneyplus|hotstar|hulu|max|hbomax)\./i;

// Injected into the main page and into attached iframes. Does not sandbox anything.
const POPUP_SCRIPT = `(() => {
  if (window.__lumenPopupCloser) return;
  window.__lumenPopupCloser = 1;
  function stub() {
    return {
      closed: false,
      close: function () { this.closed = true; },
      focus: function () {},
      blur: function () {},
      postMessage: function () {},
      location: { href: 'about:blank', replace: function () {}, assign: function () {}, reload: function () {} }
    };
  }
  function blockedOpen() { return stub(); }
  function install() {
    try { window.open = blockedOpen; } catch (e) {}
  }
  install();
  setInterval(function () {
    try { if (window.open !== blockedOpen) install(); } catch (e) {}
  }, 400);
  function eatBlank(ev) {
    var node = ev.target;
    if (!node || !node.closest) return;
    var link = node.closest('a[target="_blank"], a[target="_new"], area[target="_blank"]');
    if (!link) return;
    ev.preventDefault();
    ev.stopPropagation();
  }
  document.addEventListener('click', eatBlank, true);
  document.addEventListener('auxclick', function (ev) {
    if (ev.button !== 1) return;
    var node = ev.target;
    if (!node || !node.closest) return;
    if (node.closest('a[href], area[href]')) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);
})();`;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isProtectedUrl(url) {
  return PROTECTED_HOSTS.test(hostOf(url || ''));
}

function tileWantsPopupCloser(tile) {
  return !!(tile && tile.blockPopups === true);
}

function shouldCloseTarget(info, mainTargetId) {
  if (!info || info.type !== 'page') return false;
  if (!info.targetId || info.targetId === mainTargetId) return false;
  const url = info.url || '';
  if (url.startsWith('devtools://')) return false;
  if (url.startsWith('chrome-extension://') || url.startsWith('extension://')) return false;
  if (url.startsWith('edge://') || url.startsWith('chrome://')) return false;
  if (isProtectedUrl(url)) return false;
  return true;
}

async function sweepPopups(cdp, mainTargetId) {
  if (!cdp || !mainTargetId) return 0;
  const { targetInfos } = await cdp.send('Target.getTargets');
  let closed = 0;
  for (const info of targetInfos || []) {
    if (!shouldCloseTarget(info, mainTargetId)) continue;
    try {
      await cdp.send('Target.closeTarget', { targetId: info.targetId });
      closed += 1;
    } catch { /* already gone */ }
  }
  return closed;
}

function stopPopupSweep(browser) {
  if (!browser || !browser._popupSweep) return;
  clearInterval(browser._popupSweep);
  browser._popupSweep = null;
}

function startPopupSweep(browser) {
  stopPopupSweep(browser);
  if (!browser || !tileWantsPopupCloser(browser.tile)) return;
  browser._popupSweep = setInterval(() => {
    if (!browser.cdp || !browser.mainTargetId || !tileWantsPopupCloser(browser.tile)) return;
    if (isProtectedUrl(browser.url)) return;
    sweepPopups(browser.cdp, browser.mainTargetId).catch(() => {});
  }, SWEEP_MS);
}

function onTargetCreated(browser, info) {
  if (browser?.setupMode) return;
  if (!browser || !browser.cdp || !tileWantsPopupCloser(browser.tile)) return;
  if (isProtectedUrl(browser.url)) return;
  if (!shouldCloseTarget(info, browser.mainTargetId)) return;
  browser.cdp.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {});
}

async function injectCloser(cdp, sessionId) {
  if (!cdp || !sessionId) return;
  await cdp.send('Page.enable', {}, sessionId).catch(() => {});
  const script = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: POPUP_SCRIPT }, sessionId).catch(() => null);
  await cdp.send('Runtime.evaluate', { expression: POPUP_SCRIPT }, sessionId).catch(() => {});
  return script?.identifier;
}

async function installForSession(browser, sessionId) {
  if (!browser._popupScripts) browser._popupScripts = new Map();
  if (browser._popupScripts.has(sessionId)) return;
  browser._popupScripts.set(sessionId, null);
  const identifier = await injectCloser(browser.cdp, sessionId);
  if (identifier) browser._popupScripts.set(sessionId, identifier);
  else browser._popupScripts.delete(sessionId);
}

async function armPopupCloser(browser) {
  stopPopupSweep(browser);
  if (!browser || !browser.cdp || !browser.pageSession) return;
  if (!tileWantsPopupCloser(browser.tile) || isProtectedUrl(browser.tile?.url)) {
    // A reused app window must not carry popup interception into Netflix or other apps.
    for (const [sessionId, identifier] of browser._popupScripts || []) {
      if (identifier) await browser.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId).catch(() => {});
    }
    browser._popupScripts?.clear();
    return;
  }
  await installForSession(browser, browser.pageSession);
  for (const sessionId of browser.frameSessions || []) {
    await installForSession(browser, sessionId);
  }
  startPopupSweep(browser);
  await sweepPopups(browser.cdp, browser.mainTargetId).catch(() => {});
}

function onAttachedIframe(browser, sessionId) {
  if (!browser || !browser.cdp || !sessionId) return;
  if (!tileWantsPopupCloser(browser.tile)) return;
  if (isProtectedUrl(browser.url)) return;
  installForSession(browser, sessionId).catch(() => {});
}

module.exports = {
  POPUP_SCRIPT,
  SWEEP_MS,
  tileWantsPopupCloser,
  isProtectedUrl,
  shouldCloseTarget,
  sweepPopups,
  startPopupSweep,
  stopPopupSweep,
  onTargetCreated,
  armPopupCloser,
  onAttachedIframe
};
