'use strict';
// Runs streaming sites in Microsoft Edge (so Netflix & co. get their DRM and full quality) in its own
// profile, and steers it over the DevTools protocol: place it on the projector, pause it, close ad popups.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { BLOCKED_URLS, YOUTUBE_SCRIPT } = require('./adblock');
const { POINTER_SCRIPT } = require('./pointer');
const popupCloser = require('./popup-closer');
const { CONTEXT_JS, replaceFieldExpression } = require('./page-context');
const { tvShellScript, usesTvShell } = require('./tv-shell');
const { allowedOrigins, allowsNavigation } = require('./navigation-policy');
const { SITE_ACTIONS,siteControlsExpression } = require('./site-controls');

const TV_USER_AGENT =
  'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15';

const PAUSE_JS = "document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}});";

// name from the phone remote -> [key, code, virtual key code, text typed by the key]
const CDP_KEYS = {
  Left: ['ArrowLeft', 'ArrowLeft', 37], Up: ['ArrowUp', 'ArrowUp', 38], Right: ['ArrowRight', 'ArrowRight', 39], Down: ['ArrowDown', 'ArrowDown', 40],
  Enter: ['Enter', 'Enter', 13, '\r'], Esc: ['Escape', 'Escape', 27], Backspace: ['Backspace', 'Backspace', 8],
  Space: [' ', 'Space', 32, ' '], Tab: ['Tab', 'Tab', 9], Home: ['Home', 'Home', 36], End: ['End', 'End', 35],
  PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34], Delete: ['Delete', 'Delete', 46],
  F: ['f', 'KeyF', 70, 'f'], M: ['m', 'KeyM', 77, 'm'], J: ['j', 'KeyJ', 74, 'j'], K: ['k', 'KeyK', 75, 'k'], L: ['l', 'KeyL', 76, 'l']
};

// Play/pause the video the viewer is most likely watching.
const TOGGLE_JS = `(() => {
  if (window.LumenTV && typeof window.LumenTV.togglePlay === 'function') {
    try { window.LumenTV.togglePlay(); return 'lumen'; } catch (e) {}
  }
  const vids = Array.from(document.querySelectorAll('video,audio'));
  const v = vids.find((x) => !x.paused && !x.ended) || vids.find((x) => x.readyState > 0 && x.offsetWidth > 0) || vids[0];
  if (!v) return 'none';
  if (v.paused) { v.play(); return 'play'; }
  v.pause();
  return 'pause';
})()`;

function findEdge(custom) {
  const candidates = [
    custom,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe')
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal Chrome DevTools Protocol client (flat sessions) over one WebSocket. */
class Cdp extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, { perMessageDeflate: false });
      this.ws = ws;
      ws.once('open', resolve);
      ws.once('error', reject);
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: fail, timer } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) fail(new Error(`${msg.error.message} (${msg.error.code})`));
          else ok(msg.result || {});
        } else if (msg.method) {
          this.emit('event', msg);
        }
      });
      ws.on('close', () => {
        for (const { reject: fail, timer } of this.pending.values()) {
          clearTimeout(timer);
          fail(new Error('Browser connection closed'));
        }
        this.pending.clear();
        this.emit('close');
      });
    });
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('Not connected'));
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

class TvBrowser extends EventEmitter {
  constructor({ edgePath, debugPort, profileDir, headless = false, mediaKey = null }) {
    super();
    this.headless = headless; // for tests: no window, no sound
    this.edgePath = findEdge(edgePath);
    this.port = debugPort;
    this.profileDir = profileDir;
    this.mediaKey = mediaKey;
    this.cdp = null;
    this.child = null;
    this.reset();
  }

  reset() {
    this.tile = null;
    this.mainTargetId = null;
    this.pageSession = null;
    this.mainFrameId = null;
    this.frameSessions = new Set();
    this._popupScripts = new Map();
    this.contexts = new Map();
    this.focusedField = null;
    this.mediaContext = null;
    this.siteActionContexts = new Map();
    this.siteCommandBusy = false;
    this.shellScriptId = null;
    this.setupMode = false;
    this.title = '';
    this.url = '';
    this.adScriptId = null;
    this.pointerScriptId = null;
    this.pointer = null; // virtual mouse position inside the page
    this.view = null;
    this.viewAt = 0;
    this._moveAcc = { dx: 0, dy: 0 };
    this._moveBusy = false;
    popupCloser.stopPopupSweep(this);
  }

  get available() {
    return !!this.edgePath;
  }

  get active() {
    return !!this.mainTargetId;
  }

  status() {
    return this.active ? { tileId: this.tile && this.tile.id, name: this.tile && this.tile.name, title: this.title, url: this.url } : null;
  }

  _version() {
    return new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: this.port, path: '/json/version', timeout: 800 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  _flags(extra = []) {
    return [
      `--user-data-dir=${this.profileDir}`,
      `--remote-debugging-port=${this.port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      // Edge would otherwise sign this profile into the Windows account and sync every extension
      // into it, opening dozens of welcome tabs. The TV profile stays clean and local.
      '--disable-sync',
      '--disable-features=Translate,msEdgeSidebarV2,msImplicitSignin',
      ...(this.headless ? ['--headless=new', '--mute-audio'] : []),
      ...extra
    ];
  }

  async _ensureConnected() {
    if (this.cdp && this.cdp.ws && this.cdp.ws.readyState === WebSocket.OPEN) return;
    const v = await this._version();
    if (!v) throw new Error('Edge is not running');
    this.cdp = new Cdp(v.webSocketDebuggerUrl);
    await this.cdp.connect();
    this.cdp.on('event', (m) => this._onEvent(m));
    this.cdp.on('close', () => {
      this.cdp = null;
      if (this.active) {
        this.reset();
        this.emit('closed');
      }
    });
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
  }

  _onEvent({ method, params, sessionId }) {
    if (method === 'Fetch.requestPaused' && sessionId === this.pageSession) {
      const blocked = params.resourceType === 'Document' && params.frameId === this.mainFrameId &&
        !allowsNavigation(this.tile, params.request.url);
      this.cdp.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
        requestId: params.requestId, ...(blocked ? { errorReason: 'Aborted' } : {})
      }, sessionId).catch(() => {});
      if (blocked) this.emit('navigation-blocked');
    } else if (method === 'Page.frameNavigated' && sessionId === this.pageSession && !params.frame.parentId) {
      this.mainFrameId = params.frame.id;
    } else if (method === 'Target.targetCreated') {
      popupCloser.onTargetCreated(this, params.targetInfo);
    } else if (method === 'Target.targetInfoChanged') {
      const info = params.targetInfo;
      if (info.targetId === this.mainTargetId) {
        this.title = info.title || '';
        this.url = info.url || '';
        this.emit('title', this.status());
      }
    } else if (method === 'Target.targetDestroyed') {
      if (params.targetId === this.mainTargetId) {
        this.reset();
        this.emit('closed');
      }
    } else if (method === 'Target.attachedToTarget') {
      // Cross-origin iframes (video embeds) get their own session so we can pause them too.
      if ((sessionId === this.pageSession || this.frameSessions.has(sessionId)) && params.targetInfo.type === 'iframe') {
        this.frameSessions.add(params.sessionId);
        this.cdp.send('Runtime.enable', {}, params.sessionId).catch(() => {});
        this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, params.sessionId).catch(() => {});
        popupCloser.onAttachedIframe(this, params.sessionId);
        if (this.tile && this.tile.adblock) {
          this.cdp.send('Network.enable', {}, params.sessionId)
            .then(() => this.cdp.send('Network.setBlockedURLs', { urls: BLOCKED_URLS }, params.sessionId))
            .catch(() => {});
        }
      }
    } else if (method === 'Target.detachedFromTarget') {
      this.frameSessions.delete(params.sessionId);
      this._popupScripts.delete(params.sessionId);
      for (const [key, context] of this.contexts) if (context.sessionId === params.sessionId) this.contexts.delete(key);
    } else if (method === 'Runtime.executionContextCreated') {
      const context = params.context;
      if (context.auxData?.isDefault && (sessionId === this.pageSession || this.frameSessions.has(sessionId))) {
        this.contexts.set(`${sessionId}:${context.id}`, { sessionId, id: context.id, frameId: context.auxData.frameId });
      }
    } else if (method === 'Runtime.executionContextDestroyed') {
      this.contexts.delete(`${sessionId}:${params.executionContextId}`);
    } else if (method === 'Runtime.executionContextsCleared') {
      for (const [key, context] of this.contexts) if (context.sessionId === sessionId) this.contexts.delete(key);
    }
  }

  /** Pre-seed a new profile so Edge never offers or performs sign-in. */
  _seedProfile() {
    const dir = path.join(this.profileDir, 'Default');
    const file = path.join(dir, 'Preferences');
    if (fs.existsSync(file)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      signin: { allowed: false },
      browser: { has_seen_welcome_page: true },
      sync: { requested: false },
      credentials_enable_service: true,
      profile: { password_manager_enabled: true }
    }));
  }

  _windowFlags(bounds) {
    if (!bounds) return [];
    return [`--window-position=${bounds.x + 40},${bounds.y + 40}`, `--window-size=${bounds.width - 80},${bounds.height - 80}`];
  }

  /** Start Edge pointing at an app-style window (Edge hands it to the running instance if there is one). */
  _launchApp(url, bounds) {
    if (!this.edgePath) throw new Error('Microsoft Edge was not found. Set browser.path in settings.json.');
    fs.mkdirSync(this.profileDir, { recursive: true });
    this._seedProfile();
    const child = spawn(this.edgePath, this._flags([`--app=${url}`, ...this._windowFlags(bounds)]), { detached: true, stdio: 'ignore' });
    child.unref();
    this.child = child;
  }

  async _spawn(url, bounds) {
    this._launchApp(url, bounds);
    for (let i = 0; i < 60; i++) {
      if (await this._version()) return;
      await sleep(250);
    }
    throw new Error('Edge did not start in time');
  }

  async _pageIds() {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    return new Set(targetInfos.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://')).map((t) => t.targetId));
  }

  /** The window we just asked for: a page target that was not there before. */
  async _waitForNewPage(before) {
    for (let i = 0; i < 60; i++) {
      const { targetInfos } = await this.cdp.send('Target.getTargets');
      const page = targetInfos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://') && !before.has(t.targetId));
      if (page) return page;
      await sleep(250);
    }
    throw new Error('Edge opened no window');
  }

  /** Open (or switch to) a tile's site in fullscreen on the given display (DIP bounds). */
  launchUrl(tile) {
    if (!tile || !tile.url) return tile && tile.url;
    if (tile.id !== 'jojo') return tile.url;
    try {
      const u = new URL(tile.url);
      u.searchParams.set('lumen', '1');
      u.searchParams.delete('open');
      return u.toString();
    } catch {
      return tile.url;
    }
  }

  /** Open (or switch to) a tile's site in fullscreen on the given display (DIP bounds). */
  async open(tile, bounds) {
    const url = this.launchUrl(tile);
    const running = !!(await this._version());
    if (!running) {
      this.cdp = null;
      this.reset();
    }

    let page = null;
    let launched = false; // Edge just opened this window pointing at the URL
    if (running) {
      await this._ensureConnected();
      if (this.active) {
        const { targetInfos } = await this.cdp.send('Target.getTargets');
        page = targetInfos.find((t) => t.targetId === this.mainTargetId) || null;
      }
    }
    if (!page) {
      // Edge is stopped, or running without a window of ours (first launch, or it was closed).
      // Always open a fresh app window rather than borrowing one the user may be using.
      if (running) {
        const before = await this._pageIds();
        this._launchApp(tile.lockNavigation ? 'about:blank' : url, bounds);
        page = await this._waitForNewPage(before);
      } else {
        await this._spawn(tile.lockNavigation ? 'about:blank' : url, bounds);
        await this._ensureConnected();
        page = await this._waitForNewPage(new Set());
      }
      launched = true;
      this.pageSession = null;
    }

    const switching = launched || !this.tile || this.tile.id !== tile.id;
    this.tile = tile;
    this.setupMode = false;
    this.mainTargetId = page.targetId;
    this.title = page.title || '';
    this.url = page.url || '';

    if (!this.pageSession) {
      const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      this.pageSession = sessionId;
      this.adScriptId = null;
      this.pointerScriptId = null;
      this.pointer = null;
      this.view = null;
      this.frameSessions.clear();
      this.contexts.clear();
      await this.cdp.send('Runtime.enable', {}, sessionId);
      await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
      await this.cdp.send('Page.enable', {}, sessionId);
      // The page behaves as if it is focused even when another window is in front, so remote input
      // (sent straight into the page) always lands, whatever window the laptop is showing.
      await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
      // On-screen cursor for the phone's touchpad.
      const pointer = await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: POINTER_SCRIPT }, sessionId);
      this.pointerScriptId = pointer.identifier;
      await this.cdp.send('Runtime.evaluate', { expression: POINTER_SCRIPT }, sessionId).catch(() => {});
    }

    // Some sites (YouTube's TV layout) only serve their big-screen UI to TV user agents.
    await this.cdp.send('Emulation.setUserAgentOverride', { userAgent: tile.tvUserAgent ? TV_USER_AGENT : '' }, this.pageSession);

    await this._applyAdblock(tile);
    await this._applyTvShell(tile);
    await this.cdp.send('Fetch.disable', {}, this.pageSession);
    const { frameTree } = await this.cdp.send('Page.getFrameTree', {}, this.pageSession);
    this.mainFrameId = frameTree.frame.id;
    if (tile.lockNavigation) {
      await this.cdp.send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] }, this.pageSession);
    }
    // Install popup protection before navigating, including the very first visit.
    await popupCloser.armPopupCloser(this);

    // A freshly launched window already loads the URL, unless it needs reloading under the TV user agent
    // or with the ad blocker in place.
    if (switching && (!launched || tile.tvUserAgent || tile.adblock || tile.lockNavigation)) {
      await this.cdp.send('Page.navigate', { url }, this.pageSession).catch(() => {});
    }

    if (!this.headless) await this.place(bounds);
    await popupCloser.armPopupCloser(this);
    this.emit('title', this.status());
  }

  /** Turn the built-in ad blocker on for tiles that ask for it, and off again for the rest. */
  async _applyAdblock(tile) {
    const session = this.pageSession;
    if (this.adScriptId) {
      await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.adScriptId }, session).catch(() => {});
      this.adScriptId = null;
    }
    await this.cdp.send('Network.enable', {}, session);
    if (tile.adblock) {
      const { identifier } = await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: YOUTUBE_SCRIPT }, session);
      this.adScriptId = identifier;
    }
    await this.cdp.send('Network.setBlockedURLs', { urls: tile.adblock ? BLOCKED_URLS : [] }, session);
  }

  async _applyTvShell(tile) {
    if (this.shellScriptId) {
      await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.shellScriptId }, this.pageSession).catch(() => {});
      this.shellScriptId = null;
    }
    if (!usesTvShell(tile)) return;
    const source = tvShellScript(tile);
    const result = await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, this.pageSession);
    this.shellScriptId = result.identifier;
    await this.cdp.send('Runtime.evaluate', { expression: source }, this.pageSession).catch(() => {});
  }

  /** Move the Edge window onto a display (DIP bounds) and make it fullscreen there. */
  async place(bounds) {
    if (!this.active || !bounds) return;
    const { windowId } = await this.cdp.send('Browser.getWindowForTarget', { targetId: this.mainTargetId });
    const want = { left: bounds.x + 40, top: bounds.y + 40, width: bounds.width - 80, height: bounds.height - 80 };
    const current = async () => (await this.cdp.send('Browser.getWindowBounds', { windowId })).bounds;
    const inside = (b) => b.left >= bounds.x - 8 && b.left < bounds.x + bounds.width && b.top >= bounds.y - 8 && b.top < bounds.y + bounds.height;

    // A fullscreen/maximized window ignores a new position, so drop to a normal window first.
    let now = await current();
    if (now.windowState !== 'normal') {
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await sleep(400);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', ...want } });
      await sleep(300);
      now = await current();
      if (inside(now)) break;
    }
    if (!inside(now)) throw new Error(`Could not move the browser onto the projector (window is at ${now.left},${now.top})`);
    await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    this.view = null; // the page just changed size
    await this.cdp.send('Page.bringToFront', {}, this.pageSession).catch(() => {});
  }

  async bringToFront() {
    if (!this.active) return;
    await this.cdp.send('Page.bringToFront', {}, this.pageSession).catch(() => {});
  }

  /** Pause every video/audio element, including ones inside cross-origin iframes. */
  async pause() {
    if (!this.active) return;
    const sessions = [this.pageSession, ...this.frameSessions];
    await Promise.all(
      sessions.map((s) => this.cdp.send('Runtime.evaluate', { expression: PAUSE_JS }, s).catch(() => {}))
    );
  }

  // ---------------------------------------------------------------- remote input, straight into the page
  // None of this touches the Windows keyboard or mouse, so it works whichever window has focus.

  /** Press and release a key (name as sent by the phone: Left, Enter, Esc, Space, F, ...). */
  async key(name) {
    const def = CDP_KEYS[name];
    if (!def || !this.active) return false;
    const [key, code, vk, text] = def;
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    const session = this.focusedField?.sessionId || this.pageSession;
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) }, session);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, session);
    return true;
  }

  /** Type text into whatever field is focused on the page. */
  async text(str) {
    if (!this.active || !str) return;
    await this.cdp.send('Input.insertText', { text: str }, this.focusedField?.sessionId || this.pageSession);
  }

  async replaceText(fieldId, text) {
    if (!this.active) return false;
    await this.interactionState();
    if (!this.focusedField || this.focusedField.fieldId !== fieldId) return false;
    const field = this.focusedField;
    const { result } = await this.cdp.send('Runtime.evaluate', {
      expression: replaceFieldExpression(fieldId, text.slice(0, 2000)),
      contextId: field.id, returnByValue: true, userGesture: true
    }, field.sessionId);
    return result?.value === true;
  }

  async back() {
    if (!this.active) return;
    if (usesTvShell(this.tile)) {
      const handled = await this.evaluate('window.__lumenTVNavigation?.back()').catch(() => false);
      if (handled) {
        if (handled === 'escape') await this.key('Esc');
        return;
      }
      const history = await this.cdp.send('Page.getNavigationHistory', {}, this.pageSession);
      const origins = allowedOrigins(this.tile);
      const previous = history.entries.slice(0, history.currentIndex).reverse().find(entry => {
        try { return origins.includes(new URL(entry.url).origin); } catch { return false; }
      });
      if (previous) await this.cdp.send('Page.navigateToHistoryEntry', { entryId: previous.id }, this.pageSession);
      else this.emit('home-requested');
      return;
    }
    await this.cdp.send('Runtime.evaluate', { expression: 'history.back()', userGesture: true }, this.pageSession);
  }

  async _viewport() {
    const m = await this.cdp.send('Page.getLayoutMetrics', {}, this.pageSession);
    const v = m.cssVisualViewport || m.visualViewport || m.layoutViewport;
    this.view = { w: Math.round(v.clientWidth || v.width || 1280), h: Math.round(v.clientHeight || v.height || 720) };
    this.viewAt = Date.now();
    if (!this.pointer) this.pointer = { x: this.view.w / 2, y: this.view.h / 2 };
  }

  _drawPointer(down) {
    const p = this.pointer;
    this.cdp.send('Runtime.evaluate', { expression: `window.__lumenCursor&&window.__lumenCursor(${Math.round(p.x)},${Math.round(p.y)},${down ? 'true' : 'false'})` }, this.pageSession).catch(() => {});
  }

  /** Move the virtual mouse by a touchpad delta. Bursts of moves are merged into one event. */
  pointerMove(dx, dy) {
    if (!this.active) return;
    this._moveAcc.dx += dx;
    this._moveAcc.dy += dy;
    if (this._moveBusy) return;
    this._moveBusy = true;
    setImmediate(() => this._flushMove());
  }

  async _flushMove() {
    try {
      if (!this.active) return;
      if (!this.view || Date.now() - this.viewAt > 10000) await this._viewport();
      const { dx, dy } = this._moveAcc;
      this._moveAcc = { dx: 0, dy: 0 };
      const p = this.pointer;
      p.x = Math.min(Math.max(p.x + dx, 0), this.view.w - 1);
      p.y = Math.min(Math.max(p.y + dy, 0), this.view.h - 1);
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 }, this.pageSession);
      this._drawPointer(false);
    } catch {
      this._moveAcc = { dx: 0, dy: 0 };
    } finally {
      this._moveBusy = false;
      if (this._moveAcc.dx || this._moveAcc.dy) this.pointerMove(0, 0);
    }
  }

  async click(button = 'left', double = false) {
    if (!this.active) return;
    if (!this.pointer) await this._viewport();
    const p = this.pointer;
    const b = button === 'right' ? 'right' : 'left';
    const mouse = (type, clickCount) =>
      this.cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: b, buttons: type === 'mousePressed' ? (b === 'left' ? 1 : 2) : 0, clickCount }, this.pageSession);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 }, this.pageSession);
    for (let i = 1; i <= (double ? 2 : 1); i++) {
      this._drawPointer(true);
      await mouse('mousePressed', i);
      await mouse('mouseReleased', i);
    }
    this._drawPointer(false);
  }

  /** Positive = scroll the page down. */
  async scroll(notches) {
    if (!this.active) return;
    if (!this.pointer) await this._viewport();
    const p = this.pointer;
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: notches * 100 }, this.pageSession);
  }

  /** Play or pause the current video, including players inside iframes. */
  async togglePlay() {
    if (!this.active) return null;
    // The same Windows media key used by headset buttons. Never send Space into a focused form.
    if (this.mediaKey && !this.headless) {
      await this.bringToFront();
      await this.mediaKey();
      return 'system-media-key';
    }
    await this.interactionState();
    return this.evaluateMediaContext(TOGGLE_JS);
  }

  /** Seek through a Lumen-aware site, with a standards-based video fallback. */
  async seekBy(seconds) {
    if (!this.active) return false;
    const amount = Math.max(-600, Math.min(600, Number(seconds) || 0));
    const expression = `(() => {
      if (window.LumenTV && typeof window.LumenTV.seekBy === 'function') {
        try { window.LumenTV.seekBy(${JSON.stringify(amount)}); return true; } catch (e) {}
      }
      const videos = Array.from(document.querySelectorAll('video,audio'));
      const video = videos.find((v) => !v.paused && !v.ended) || videos.find((v) => v.readyState > 0) || videos[0];
      if (!video) return false;
      video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, video.currentTime + ${JSON.stringify(amount)}));
      return true;
    })()`;
    await this.interactionState();
    return !!(await this.evaluateMediaContext(expression));
  }

  async fullscreen() {
    if (!this.active) return false;
    await this.interactionState();
    return !!(await this.evaluateMediaContext(`(() => {
      if (document.fullscreenElement) { document.exitFullscreen(); return true; }
      const video = Array.from(document.querySelectorAll('video')).find(v => v.offsetWidth > 0 && v.readyState > 0);
      if (!video) return false;
      video.requestFullscreen?.(); return true;
    })()`));
  }

  /**
   * Read a small JSON-safe playback snapshot for the phone remote. Watch JoJo can expose
   * window.LumenTV.getState(); ordinary sites fall back to their most relevant video element.
   */
  async mediaState() {
    return (await this.interactionState()).media;
  }

  async evaluateContexts(expression) {
    if (!this.active || !this.cdp) return [];
    const contexts = [...this.contexts.values()];
    if (!contexts.length) contexts.push({ sessionId: this.pageSession });
    return Promise.all(contexts.map(async context => {
      const response = await this.cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, userGesture: true,
        ...(context.id ? { contextId: context.id } : {})
      }, context.sessionId).catch(() => null);
      return { ...context, value: response?.result?.value ?? null };
    }));
  }

  async evaluateMediaContext(expression) {
    const context = this.mediaContext;
    if (!this.active || !context) return null;
    const response = await this.cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, userGesture: true,
      ...(context.id ? { contextId: context.id } : {})
    }, context.sessionId).catch(() => null);
    return response?.result?.value ?? null;
  }

  async interactionState() {
    if (!this.active) return { media: null, input: null, focus: null, controls: {}, navigation: 'dpad' };
    const controlsExpression=siteControlsExpression(this.tile?.id,allowedOrigins(this.tile));
    const snapshots = await this.evaluateContexts(`({...${CONTEXT_JS},controls:${controlsExpression}})`);
    const focused = await this.focusedSnapshot(snapshots);
    this.focusedField = focused?.value?.input ? { ...focused, fieldId: focused.value.input.fieldId } : null;
    const candidates = snapshots.filter(item => item.value?.media);
    candidates.sort((a, b) => Number(b.value.media.playing) - Number(a.value.media.playing) ||
      ((b.value.media.width || 0) * (b.value.media.height || 0)) - ((a.value.media.width || 0) * (a.value.media.height || 0)));
    const media = candidates[0]?.value.media || null;
    this.mediaContext = candidates[0] || null;
    const root = snapshots.find(item => item.frameId === this.mainFrameId) || snapshots.find(item => item.sessionId === this.pageSession);
    const site = root?.value?.site;
    const controls={};this.siteActionContexts.clear();
    const controlSources=[root,this.mediaContext].filter((item,index,array)=>item&&array.indexOf(item)===index);
    for(const name of SITE_ACTIONS){
      const context=controlSources.find(item=>item.value?.controls?.actions?.[name]);
      controls[name]=!!context;
      if(context)this.siteActionContexts.set(name,{sessionId:context.sessionId,id:context.id,pageKey:context.value.controls.pageKey});
    }
    const focus = focused?.value?.focus || null;
    if (media && site) Object.assign(media, site, { actions: { ...media.actions, ...site.actions } });
    if(media){Object.assign(media,root?.value?.controls?.info||{});media.actions={...media.actions,...controls};}
    if (media && this.title && !site?.title && !root?.value?.controls?.info?.title) media.title = this.title;
    return {
      media, input: focused?.value?.input || null, focus, controls,
      navigation: usesTvShell(this.tile) || this.tile?.tvUserAgent ? 'dpad' : 'touch'
    };
  }

  /** Follow the actual iframe owner chain, never a stale activeElement in an inactive frame. */
  async focusedSnapshot(snapshots) {
    let current = snapshots.find(item => item.frameId === this.mainFrameId) || snapshots.find(item => item.sessionId === this.pageSession);
    for (let depth=0; current?.value?.activeFrame && depth<12; depth++) {
      let objectId;
      const sessionId = current.sessionId;
      try {
        const { result } = await this.cdp.send('Runtime.evaluate', {
          expression:'(() => {let n=document.activeElement;while(n?.shadowRoot?.activeElement)n=n.shadowRoot.activeElement;return n})()',
          ...(current.id ? { contextId:current.id } : {})
        },sessionId);
        objectId = result?.objectId;
        if (!objectId) return null;
        const { node } = await this.cdp.send('DOM.describeNode',{objectId},sessionId);
        const child = snapshots.find(item => item.frameId === node.frameId);
        if (!child || child === current) return null;
        current = child;
      } catch { return null; }
      finally { if (objectId) await this.cdp.send('Runtime.releaseObject',{objectId},sessionId).catch(()=>{}); }
    }
    return current || null;
  }

  /** Call one of the deliberately small site integration hooks. */
  async siteCommand(name) {
    if (!this.active || !SITE_ACTIONS.includes(name) || this.siteCommandBusy) return false;
    // Use the context last shown to the phone, then re-query the DOM before clicking anything.
    const context=this.siteActionContexts.get(name);
    if(!context)return false;
    this.siteCommandBusy=true;
    try{
      const response=await this.cdp.send('Runtime.evaluate',{
        expression:siteControlsExpression(this.tile?.id,allowedOrigins(this.tile),name,context.pageKey),returnByValue:true,userGesture:true,
        ...(context.id?{contextId:context.id}:{})
      },context.sessionId);
      return response?.result?.value===true;
    }catch{return false;}finally{this.siteCommandBusy=false;}
  }

  async evaluate(expression) {
    if (!this.active) return null;
    const { result } = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true }, this.pageSession);
    return result && result.value;
  }

  /** Process id of Edge's main (browser) process, used to focus its window. */
  async pid() {
    try {
      await this._ensureConnected();
      const { processInfo } = await this.cdp.send('SystemInfo.getProcessInfo');
      const main = processInfo.find((p) => p.type === 'browser');
      return main ? main.id : null;
    } catch {
      return null;
    }
  }

  /** Close the TV browser gracefully so logins and cookies are saved. */
  async close() {
    const had = this.cdp;
    popupCloser.stopPopupSweep(this);
    this.reset();
    if (!(await this._version())) return;
    try {
      if (!had) await this._ensureConnected();
      await this.cdp.send('Browser.close');
    } catch { /* it is closing; the socket drops */ }
    for (let i = 0; i < 20 && (await this._version()); i++) await sleep(250);
    this.cdp = null;
  }

  /** Open the TV profile in a normal window, for signing in or installing an ad blocker. */
  openSetupWindow(urls = [this.tile?.url || 'https://www.netflix.com/login']) {
    if (!this.edgePath) throw new Error('Microsoft Edge was not found');
    fs.mkdirSync(this.profileDir, { recursive: true });
    this._seedProfile();
    this.setupMode = true;
    popupCloser.stopPopupSweep(this);
    spawn(this.edgePath, this._flags(['--new-window', ...urls]), { detached: true, stdio: 'ignore' }).unref();
  }
}

module.exports = { TvBrowser, Cdp, findEdge };
