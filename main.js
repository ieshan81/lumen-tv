'use strict';
const {
  app, BrowserWindow, Tray, Menu, screen, globalShortcut, powerSaveBlocker, ipcMain, nativeImage, net, shell, clipboard
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');

const cfg = require('./src/config');
const input = require('./src/input');
const displays = require('./src/displays');
const audio = require('./src/audio');
const { TvBrowser } = require('./src/browser');
const { VolumeMonitor } = require('./src/volume');
const { VolumeOverlay } = require('./src/volume-overlay');
const { SITE_ACTIONS } = require('./src/site-controls');
const { RemoteServer } = require('./src/remote');
const firewall = require('./src/firewall');

app.setName('Lumen TV');
if (process.platform === 'win32') app.setAppUserModelId('com.lumen.tv');

const DEV = process.argv.includes('--dev'); // windowed launcher, no system changes (sound, power)
const NO_AUDIO = DEV || process.argv.includes('--no-audio');
const ICON_DIR = path.join(cfg.ROOT, 'cache', 'icons');
const LOG_FILE = path.join(cfg.ROOT, 'cache', 'lumen.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loginItemSettings(openAtLogin) {
  return {
    ...(openAtLogin === undefined ? {} : { openAtLogin }),
    name: 'Lumen TV',
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
  };
}

function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* logging is best effort */ }
}

// A background app must never pop an error dialog onto the projector; log and carry on instead.
process.on('uncaughtException', (err) => log('uncaught exception:', err));
process.on('unhandledRejection', (err) => log('unhandled rejection:', err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let settings;
let tiles = [];
let browser;
let volume;
let volumeOverlay;
let remote;
let tray;

const state = {
  mode: 'off', // off | home (launcher showing) | app (a site/app is on screen)
  display: null,
  win: null,
  blocker: null,
  audioChange: null,
  suppressed: false, // user left TV mode while the projector is still plugged in
  sleepAt: null,
  sleepTimer: null,
  clients: 0,
  icons: {},
  launching: null,
  firewallBlocked: false, // Windows Firewall would drop phones trying to reach the remote
  appPid: null, // Edge's browser process, so keystrokes can be kept pointed at its window
  starting: false,
  startMessage: '',
  lastError: '',
  audio: { status: 'idle', name: '', error: '' },
  audioDevices: [],
  audioDevicesError: '',
  audioDevicesLoading: false,
  media: null,
  input: null,
  focus: null,
  volume: null,
  controls: {},
  navigation: 'dpad',
  qrFor: '',
  qr: ''
};

// ---------------------------------------------------------------- UI state

async function viewState() {
  const urls = remote ? remote.urls() : [];
  if (urls[0] && state.qrFor !== urls[0]) {
    state.qr = await QRCode.toString(urls[0], { type: 'svg', margin: 1, color: { dark: '#0b0d14', light: '#ffffff' } });
    state.qrFor = urls[0];
  }
  const running = browser.status();
  const runningTile = running && tiles.find((t) => t.id === running.tileId);
  const detectedProjector = displays.findProjector(settings);
  return {
    mode: state.mode,
    tiles: tiles.map((t) => ({ id: t.id, name: t.name, desc: t.desc, accent: t.accent, icon: state.icons[t.id] || null })),
    running: running && { ...running, accent: runningTile && runningTile.accent, icon: runningTile && state.icons[runningTile.id] },
    launching: state.launching,
    starting: state.starting,
    startMessage: state.startMessage,
    error: state.lastError,
    audio: state.audio,
    audioDevices: state.audioDevices.map(device => ({...device,isDefault:state.volume ? device.id === state.volume.deviceId : device.isDefault})),
    audioDevicesError: state.audioDevicesError,
    audioDevicesLoading: state.audioDevicesLoading,
    volumeAutoHide: settings.audio.volumeAutoHide !== false,
    media: state.media,
    input: state.input,
    focus: state.focus,
    volume: state.volume,
    controls: state.controls,
    volumeOverlayVisible: !!volumeOverlay?.visible,
    navigation: state.navigation,
    remote: { urls, stable: remote ? remote.stableUrl() : '', qr: state.qr, clients: state.clients, blocked: state.firewallBlocked },
    sleepAt: state.sleepAt,
    hotkeys: settings.homeHotkeys,
    projector: {
      ...displays.recognitionState(settings),
      connected: !!detectedProjector,
      label: (detectedProjector && detectedProjector.label) || '',
      match: (settings.projector && settings.projector.match) || 'projector'
    }
  };
}

function remoteState(s) {
  return {
    t: 'state',
    mode: s.mode,
    tiles: s.tiles.map(({ id, name, accent }) => ({ id, name, accent, icon: `/tile-icon/${encodeURIComponent(id)}` })),
    running: s.running && { name: s.running.name, title: s.running.title, accent: s.running.accent, tileId: s.running.tileId, icon: s.running.tileId ? `/tile-icon/${encodeURIComponent(s.running.tileId)}` : '' },
    starting: s.starting,
    startMessage: s.startMessage,
    error: s.error,
    projector: s.projector,
    audio: s.audio,
    audioDevices: s.audioDevices,
    audioDevicesError: s.audioDevicesError,
    audioDevicesLoading: s.audioDevicesLoading,
    volumeAutoHide: s.volumeAutoHide,
    media: s.media,
    input: s.input,
    focus: s.focus,
    volume: s.volume && {percent:s.volume.percent,muted:s.volume.muted,name:s.volume.name},
    controls: s.controls,
    volumeOverlayVisible: s.volumeOverlayVisible,
    navigation: s.navigation,
    sleepAt: s.sleepAt,
    stableUrl: s.remote.stable
  };
}

async function pushState() {
  const s = await viewState();
  // The launcher is hidden behind Edge during a movie. Keep its renderer idle.
  if (state.win && !state.win.isDestroyed() && state.win.isVisible()) state.win.webContents.send('state', s);
  if (remote) remote.broadcast(remoteState(s));
  updateTray();
}

function toast(text) {
  log('toast:', text);
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('toast', text);
  if (remote) remote.broadcast({ t: 'toast', text });
}

// ---------------------------------------------------------------- launcher window

function createLauncher(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: DEV ? b.x + 60 : b.x,
    y: DEV ? b.y + 60 : b.y,
    width: DEV ? 1280 : b.width,
    height: DEV ? 720 : b.height,
    show: false,
    frame: DEV,
    skipTaskbar: !DEV,
    autoHideMenuBar: true,
    backgroundColor: '#08090d',
    title: 'Lumen TV',
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true
    }
  });
  win.setMenuBarVisibility(false);
  win.on('show', () => pushState());
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => {
    if (!DEV) {
      win.setBounds(b);
      win.setFullScreen(true);
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    showLauncher();
  });
  win.on('closed', () => {
    state.win = null;
    if (state.mode !== 'off') exitTvMode({ suppress: true });
  });
  // Block navigation or popups out of the launcher; the sites live in Edge.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  state.win = win;
}

function showLauncher() {
  const win = state.win;
  if (!win || win.isDestroyed()) return;
  if (!DEV) win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.focus();
  win.moveTop();
  // If another app holds the foreground, Electron's own focus() is ignored: push the launcher forward.
  if (input.foregroundPid() !== process.pid) input.focusProcess(process.pid, { aggressive: true });
}

/** Windows will not hand focus to a background app, so push Edge's window to the front explicitly. */
async function focusApp() {
  state.appPid = (await browser.pid()) || state.appPid;
  if (!state.appPid) return false;
  for (let i = 0; i < 6; i++) {
    if (input.focusProcess(state.appPid, { aggressive: i >= 2 })) return true;
    await sleep(120);
  }
  log('could not focus the browser window:', input.describeFocus(state.appPid));
  return false;
}

let lastFocusToast = 0;

/**
 * Before remote input reaches the PC, make sure it goes to the app and not some other window.
 * Returns false (and drops the input) if the app cannot be brought to the front, so text typed on the
 * phone never ends up in the wrong window.
 */
function ensureAppFocus() {
  if (state.mode !== 'app' || !state.appPid) return true; // nothing to guard: TV mode off, or a non-browser app
  if (input.foregroundPid() === state.appPid) return true;
  if (input.focusProcess(state.appPid)) return true;
  if (Date.now() - lastFocusToast > 4000) {
    lastFocusToast = Date.now();
    log('remote input dropped, browser not focused:', input.describeFocus(state.appPid));
    toast('Could not bring the app to the front. Close any popups on the laptop.');
  }
  return false;
}

// ---------------------------------------------------------------- TV mode

function registerHotkeys() {
  for (const accel of settings.homeHotkeys) {
    try {
      if (!globalShortcut.register(accel, () => goHome())) log('hotkey already taken:', accel);
    } catch (err) {
      log('bad hotkey', accel, err.message);
    }
  }
}

async function enterTvMode(display) {
  if (state.mode !== 'off') return;
  log('entering TV mode on', display.label || display.id);
  state.display = display;
  try{displays.rememberProjector(display);}catch(err){log('could not remember projector:',err.message);}
  state.mode = 'home';
  state.starting = false;
  state.startMessage = '';
  state.lastError = '';
  state.audio = !settings.audio.switchToProjector
    ? { status: 'disabled', name: '', error: '' }
    : NO_AUDIO
      ? { status: 'ready', name: 'Audio unchanged in test mode', error: '' }
      : { status: 'switching', name: '', error: '' };
  state.suppressed = false;
  createLauncher(display);
  if(!NO_AUDIO)volume.watch();
  if (state.firewallBlocked) {
    setTimeout(() => toast('Your phone can\'t reach the remote: Windows Firewall is blocking it. On the laptop, click the Lumen tray icon, then "Fix phone connection".'), 3500);
  }
  input.setClamp(screen.dipToScreenRect(null, display.bounds));
  registerHotkeys();
  if (!DEV) {
    state.blocker = powerSaveBlocker.start('prevent-display-sleep');
    if (settings.audio.switchToProjector && !NO_AUDIO) {
      // The projector's HDMI audio can take a few seconds to appear after the screen is switched on.
      (async () => {
        for (let attempt = 1; attempt <= 5 && state.mode !== 'off'; attempt++) {
          try {
            const change = await audio.switchToProjector({...settings,projector:{...settings.projector,match:displays.audioMatchFor(display)||settings.projector.match}});
            if (state.mode === 'off') {
              await audio.restore(change);
              return;
            }
            state.audioChange = change;
            state.audio = { status: 'ready', name: (change && change.name) || 'Projector audio', error: '' };
            if (change) log('sound ->', change.name);
            pushState();
            return;
          } catch (err) {
            if (attempt === 5) {
              log('could not switch sound:', err.message);
              state.audio = { status: 'error', name: '', error: err.message };
              toast('Lumen started, but Windows could not switch to projector audio.');
              pushState();
            }
            else await sleep(3000);
          }
        }
      })();
    }
  }
  pushState();
}

async function exitTvMode({ suppress = false } = {}) {
  if (state.mode === 'off') return;
  log('leaving TV mode', suppress ? '(user)' : '');
  state.mode = 'off';
  state.display = null;
  volume?.stop();
  volumeOverlay?.close();
  state.volume = null;
  state.starting = false;
  state.startMessage = '';
  state.suppressed = suppress;
  state.launching = null;
  clearSleep();
  globalShortcut.unregisterAll();
  input.setClamp(null);
  if (state.blocker !== null) {
    powerSaveBlocker.stop(state.blocker);
    state.blocker = null;
  }
  const win = state.win;
  state.win = null;
  if (win && !win.isDestroyed()) win.destroy();
  state.appPid = null;
  const change = state.audioChange;
  state.audioChange = null;
  state.audio = { status: 'idle', name: '', error: '' };
  state.media = null;
  state.input = null;
  state.focus = null;
  state.controls = {};
  await audio.restore(change).catch((err) => log('could not restore sound:', err.message));
  await browser.close().catch((err) => log('closing browser:', err.message));
  pushState();
}

async function goHome() {
  if (state.mode === 'off') return;
  if (state.mode === 'app') browser.pause().catch(() => {});
  state.mode = 'home';
  showLauncher();
  pushState();
}

async function resumeApp() {
  if (state.mode !== 'home' || !browser.active) return;
  state.mode = 'app';
  if (state.win) state.win.hide();
  await browser.bringToFront();
  await focusApp();
  pushState();
}

async function launchTile(id) {
  const tile = tiles.find((t) => t.id === id);
  if (!tile || state.launching) return;
  if (state.mode === 'off') {
    const projector = displays.findProjector(settings);
    if (!projector) return toast('The projector is not connected');
    await enterTvMode(projector);
  }
  if (tile.exe) {
    spawn(tile.exe, tile.args || [], { detached: true, stdio: 'ignore' }).unref();
    state.mode = 'app';
    if (state.win) state.win.hide();
    return pushState();
  }
  state.launching = id;
  state.media = null;
  state.input = null;
  state.focus = null;
  state.controls = {};
  pushState();
  try {
    await browser.open(tile, state.display.bounds);
    state.mode = 'app';
    if (state.win) state.win.hide();
    await browser.bringToFront();
    await focusApp();
  } catch (err) {
    log('launch failed:', err);
    toast(`Could not open ${tile.name}: ${err.message}`);
  } finally {
    state.launching = null;
    pushState();
  }
}

async function closeApp() {
  state.appPid = null;
  await browser.close();
  if (state.mode === 'app') await goHome();
  else pushState();
}

// ---------------------------------------------------------------- sleep timer

function clearSleep() {
  clearTimeout(state.sleepTimer);
  state.sleepTimer = null;
  state.sleepAt = null;
}

function setSleep(minutes) {
  clearSleep();
  if (minutes > 0) {
    state.sleepAt = Date.now() + minutes * 60000;
    state.sleepTimer = setTimeout(sleepNow, minutes * 60000);
  }
  pushState();
}

async function sleepNow() {
  log('sleep timer fired');
  clearSleep();
  await browser.pause().catch(() => {});
  await sleep(1500);
  await exitTvMode({ suppress: true });
  if (settings.sleepTimer.turnOffProjector && !DEV) await displays.internalOnly();
}

// ---------------------------------------------------------------- display watching

let evaluating = false;
let lastExtend = 0;
let extendAttempts = 0; // tries to switch the projector on since it was last seen unplugged
let lastProjectorSignature = '';
let displayMissingSince = 0;

async function evaluateDisplays() {
  if (evaluating) return;
  evaluating = true;
  try {
    await displays.refreshInventory();
    const projector = displays.findProjector(settings);
    if (projector) {
      const reconnected=displayMissingSince>0;
      displayMissingSince = 0;
      extendAttempts = 0;
      if (state.mode === 'off') {
        if (settings.autoTvMode && !state.suppressed) await enterTvMode(projector);
      } else {
        const moved=reconnected||state.display?.id!==projector.id||JSON.stringify(state.display?.bounds)!==JSON.stringify(projector.bounds);
        state.display = projector;
        if (state.win && !DEV) state.win.setBounds(projector.bounds);
        input.setClamp(screen.dipToScreenRect(null, projector.bounds));
        if(moved&&browser.active)await browser.place(projector.bounds).catch(err=>log('could not reposition TV browser:',err.message));
      }
    } else {
      if (state.mode !== 'off') {
        // HDMI handshakes can briefly remove a screen. Do not close playback on the first miss.
        if(!displayMissingSince)displayMissingSince=Date.now();
        volumeOverlay?.hide();
        if(Date.now()-displayMissingSince<3500){scheduleEvaluate(900);return;}
        displayMissingSince=0;
        state.suppressed = false;
        await exitTvMode();
      } else if (settings.autoTvMode && !DEV) {
        // Plugged in but Windows is not showing a separate desktop on it (mirrored, or "PC screen only").
        const needs = await displays.projectorNeedsExtending(settings);
        if (needs === false) {
          state.suppressed = false; // really unplugged: the next connection may start TV mode again
          extendAttempts = 0;
        } else if (needs && settings.forceExtend && extendAttempts < 3 && Date.now() - lastExtend > 12000) {
          extendAttempts++;
          lastExtend = Date.now();
          log(`projector is plugged in but not switched on; setting Windows to Extend (try ${extendAttempts})`);
          await displays.extendDisplays();
        } else if (needs && extendAttempts >= 3 && extendAttempts < 4) {
          extendAttempts++;
          log('projector is plugged in but Windows would not switch it on after 3 tries; giving up until it is replugged');
        }
      }
    }
  } catch (err) {
    log('display check failed:', err);
  } finally {
    evaluating = false;
    updateTray();
    const current = displays.findProjector(settings);
    const signature = current ? `${current.id}:${current.label || ''}` : 'none';
    if (signature !== lastProjectorSignature) {
      lastProjectorSignature = signature;
      pushState().catch((err) => log('could not publish display state:', err.message));
    }
  }
}

let evalTimer;
function scheduleEvaluate(delay = 1500) {
  displays.invalidateInventory();
  clearTimeout(evalTimer);
  evalTimer = setTimeout(evaluateDisplays, delay);
}

// ---------------------------------------------------------------- phone remote

let lastMoveAt = 0;

function ensureCursorOnProjector() {
  const rect = state.display && screen.dipToScreenRect(null, state.display.bounds);
  if (!rect) return;
  const p = input.cursor();
  if (p.x < rect.x || p.y < rect.y || p.x >= rect.x + rect.width || p.y >= rect.y + rect.height) input.center();
}

function num(v, limit) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-limit, Math.min(limit, n)) : 0;
}

/** True when a website is on screen, so remote input goes straight into its page instead of through Windows. */
function viaBrowser() {
  return state.mode === 'app' && browser.active;
}

/** Fire and forget; a failed remote command should never crash or block the app. */
function bg(promise) {
  Promise.resolve(promise).catch((err) => log('remote input failed:', err.message));
}

function remoteKey(k) {
  if (state.mode === 'home' && state.win) return state.win.webContents.send('nav', k);
  if (viaBrowser()) {
    // YouTube's TV layout treats Escape as "back"; other sites expect browser history.
    if (k === 'Back') return bg(browser.tile && browser.tile.tvUserAgent ? browser.key('Esc') : browser.back());
    return bg(browser.key(k));
  }
  if (!ensureAppFocus()) return undefined;
  if (k === 'Back') return input.tap('Left', ['Alt']); // browser history back
  input.tap(k);
}

const MEDIA = {
  playpause: () => (viaBrowser() ? bg(browser.togglePlay()) : input.tap('PlayPause')),
  volup: () => bg(adjustVolume('up')),
  voldown: () => bg(adjustVolume('down')),
  mute: () => bg(adjustVolume('mute')),
  showvolume: () => bg(adjustVolume('read')),
  hidevolume: () => { volumeOverlay.hide(); bg(pushState()); },
  back10: () => (viaBrowser() ? bg(browser.seekBy(-10)) : ensureAppFocus() && input.tap('Left')),
  fwd10: () => (viaBrowser() ? bg(browser.seekBy(10)) : ensureAppFocus() && input.tap('Right')),
  fullscreen: () => (viaBrowser() ? bg(browser.fullscreen()) : ensureAppFocus() && input.tap('F'))
};

let audioRefresh = null;
async function refreshAudioDevices() {
  if (audioRefresh) return audioRefresh;
  audioRefresh = (async () => {
    state.audioDevicesLoading = true;
    await pushState();
    try { state.audioDevices = await audio.listDevices(); state.audioDevicesError = ''; }
    catch (error) { state.audioDevicesError = 'Windows audio outputs are unavailable. Try Refresh.'; log('audio device list failed:',error.message); }
    finally { state.audioDevicesLoading = false; await pushState(); }
  })().finally(() => { audioRefresh = null; });
  return audioRefresh;
}

async function chooseAudioDevice(id) {
  if (NO_AUDIO || state.mode === 'off' || state.audio.status === 'switching') return;
  const previousAudio = state.audio;
  state.audio = {...previousAudio,status:'switching',error:''};
  await pushState();
  try {
    const change = await audio.switchToDevice(id);
    if (state.mode === 'off') { await audio.restore(change); return; }
    if (!state.audioChange?.previousId && change.changed) state.audioChange = change;
    settings.audio.deviceId = change.id;
    settings.audio.deviceName = change.name;
    cfg.saveSettings(settings);
    state.audio = {status:'ready',name:change.name,error:''};
    state.volume = await volume.read().catch(() => null);
    volumeOverlay.show(state.display,state.volume);
  } catch (error) {
    state.audio = {...previousAudio,error:error.message};
    toast(error.message);
  }
  await refreshAudioDevices();
}

async function adjustVolume(command){
  if(NO_AUDIO)return toast('Volume controls are disabled in test mode.');
  try{
    const snapshot=await volume.command(command);
    state.volume=snapshot;
    if(state.mode!=='off')volumeOverlay.show(state.display,snapshot);
    await pushState();
  }catch(err){
    state.volume=null;
    if(state.mode!=='off')volumeOverlay.show(state.display,null);
    toast('Windows volume is unavailable. Use the laptop volume keys.');
    log('volume control failed:',err.message);
    await pushState();
  }
}

let startingTv = null;

/**
 * Phone-first startup. The projector is powered with its own remote; Lumen only asks Windows to extend
 * the desktop, waits for the display to become usable, then opens the launcher and switches audio.
 */
async function startTvMode() {
  if (state.mode !== 'off') return true;
  if (startingTv) return startingTv;

  startingTv = (async () => {
    state.starting = true;
    state.lastError = '';
    state.startMessage = 'Looking for the projector…';
    await pushState();
    try {
      await displays.refreshInventory(true);
      let projector = displays.findProjector(settings);
      if (!projector && settings.forceExtend && !DEV) {
        state.startMessage = 'Asking Windows to use the HDMI display…';
        await pushState();
        await displays.extendDisplays();
      }

      const configuredWait = Math.max(5, Math.min(45, Number(settings.remote.projectorWaitSeconds) || 18));
      const waitMs = (DEV ? 4 : configuredWait) * 1000;
      const deadline = Date.now() + waitMs;
      while (!projector && Date.now() < deadline) {
        await sleep(900);
        await displays.refreshInventory();
        projector = displays.findProjector(settings);
        const seconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
        state.startMessage = `Waiting for ${settings.projector.match || 'the projector'} on HDMI… ${seconds}s`;
        await pushState();
      }

      if (!projector) {
        throw new Error(`Windows cannot see ${settings.projector.match || 'the projector'}. Turn it on, select HDMI, then try again.`);
      }

      state.startMessage = 'Opening Lumen on the projector…';
      await pushState();
      await enterTvMode(projector);
      return true;
    } catch (err) {
      state.lastError = err.message || 'Lumen could not start TV mode.';
      log('phone start failed:', state.lastError);
      return false;
    } finally {
      state.starting = false;
      state.startMessage = '';
      startingTv = null;
      await pushState();
    }
  })();

  return startingTv;
}

async function handleRemote(msg) {
  switch (msg.t) {
    case 'audio':
      if (msg.action === 'refresh') await refreshAudioDevices();
      else if (msg.action === 'select' && typeof msg.id === 'string') await chooseAudioDevice(msg.id);
      break;
    case 'volume-preferences':
      if (typeof msg.autoHide !== 'boolean') break;
      settings.audio.volumeAutoHide = msg.autoHide;
      cfg.saveSettings(settings);
      volumeOverlay.setAutoHide(msg.autoHide);
      await pushState();
      break;
    case 'projector': {
      if(typeof msg.id!=='number'||!Number.isSafeInteger(msg.id))break;
      const id=msg.id;
      await displays.refreshInventory(true);
      const chosen=screen.getAllDisplays().find(d=>d.id===id&&!d.internal&&d.detected!==false&&d.id>=0);
      if(!chosen)return toast('That external display is no longer available.');
      const wasActive=state.mode!=='off';
      const switching=wasActive&&state.display?.id!==id;
      if(switching)await exitTvMode({suppress:true});
      displays.rememberProjector(chosen,{manual:true});
      if(switching)await startTvMode();
      await pushState();
      toast(`Remembered ${chosen.label||'this external display'} as your projector.`);
      break;
    }
    case 'key':
      if (typeof msg.k === 'string') remoteKey(msg.k);
      break;
    case 'move':
      if (viaBrowser()) {
        browser.pointerMove(num(msg.dx, 400), num(msg.dy, 400));
      } else if (state.mode !== 'home') {
        if (Date.now() - lastMoveAt > 5000) {
          ensureCursorOnProjector();
          ensureAppFocus();
        }
        lastMoveAt = Date.now();
        input.moveBy(num(msg.dx, 400), num(msg.dy, 400));
      }
      break;
    case 'click':
      if (viaBrowser()) bg(browser.click(msg.b === 'right' ? 'right' : 'left', !!msg.d));
      else if (state.mode !== 'home' && ensureAppFocus()) input.click(msg.b === 'right' ? 'right' : 'left', !!msg.d);
      break;
    case 'scroll':
      if (viaBrowser()) bg(browser.scroll(num(msg.n, 20)));
      else if (state.mode !== 'home' && ensureAppFocus()) input.scroll(num(msg.n, 20));
      break;
    case 'text':
      if (typeof msg.s === 'string' && viaBrowser()) {
        bg((async () => {
          await browser.text(msg.s.slice(0, 500));
          if (msg.enter) await browser.key('Enter');
        })());
      } else if (typeof msg.s === 'string' && state.mode !== 'home' && ensureAppFocus()) {
        input.typeText(msg.s.slice(0, 500));
        if (msg.enter) input.tap('Enter');
      }
      break;
    case 'media':
      if (MEDIA[msg.a]) MEDIA[msg.a]();
      break;
    case 'edit':
      if (viaBrowser() && typeof msg.fieldId === 'string' && typeof msg.s === 'string') {
        const applied = await browser.replaceText(msg.fieldId, msg.s);
        if (!applied) toast('Select the text field on the TV again.');
      }
      break;
    case 'account':
      if (viaBrowser()) {
        browser.openSetupWindow();
        toast('Sign in in the browser window. Edge can save your login in the Lumen profile.');
      }
      break;
    case 'seek':
      if (viaBrowser()) bg(browser.seekBy(num(msg.seconds, 600)));
      break;
    case 'site':
      if (viaBrowser() && SITE_ACTIONS.includes(msg.action)) {
        const applied=await browser.siteCommand(msg.action);
        if(!applied)toast('That control is no longer available on this screen.');
      }
      break;
    case 'home':
      if (state.mode === 'home') remoteKey('Esc');
      else await goHome();
      break;
    case 'resume':
      await resumeApp();
      break;
    case 'launch':
      await launchTile(String(msg.id));
      break;
    case 'closeapp':
      await closeApp();
      break;
    case 'sleep':
      setSleep(num(msg.min, 600));
      break;
    case 'exit':
      await exitTvMode({ suppress: true });
      break;
    case 'enter': {
      state.suppressed = false;
      await startTvMode();
      break;
    }
    default:
      break;
  }
}

let mediaSyncBusy = false;
let mediaSignature = '';
async function syncMediaState() {
  if (mediaSyncBusy) return;
  mediaSyncBusy = true;
  try {
    const interaction = viaBrowser() ? await browser.interactionState() : { media: null, input: null, focus: null, controls: {}, navigation: 'dpad' };
    const media = interaction.media;
    if (media && media.currentTime) media.currentTime = Math.round(media.currentTime);
    if (media && media.duration) media.duration = Math.round(media.duration);
    const signature = JSON.stringify(interaction);
    if (signature !== mediaSignature) {
      mediaSignature = signature;
      state.media = media;
      state.input = interaction.input;
      state.focus = interaction.focus;
      state.controls = interaction.controls;
      state.navigation = interaction.navigation;
      await pushState();
    }
  } catch (err) {
    log('now-playing sync failed:', err.message);
  } finally {
    mediaSyncBusy = false;
  }
}

// ---------------------------------------------------------------- firewall

async function checkFirewall() {
  if ((process.env.LUMEN_REMOTE_HOST || settings.remote.host).startsWith('127.')) return; // local-only (tests)
  const blocked = await firewall.isBlocked(settings.remote.port);
  const changed = blocked !== state.firewallBlocked;
  state.firewallBlocked = blocked;
  if (blocked) log('Windows Firewall is blocking the phone remote (no allow rule for it). Use the tray item "Fix phone connection".');
  else log('Windows Firewall allows the phone remote');
  if (changed) pushState();
  return blocked;
}

function fixFirewall() {
  log('opening the firewall fix (Windows will ask for approval)');
  firewall.openFix(settings.remote.port);
  // the fix runs in its own window; look again afterwards so the warning clears by itself
  setTimeout(checkFirewall, 25000);
  setTimeout(checkFirewall, 70000);
}

// ---------------------------------------------------------------- tray

function makeTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const r = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, 0, x - (size - 1 - r));
      const dy = Math.max(r - y, 0, y - (size - 1 - r));
      const inside = dx * dx + dy * dy <= r * r;
      // play triangle
      const tri = x >= 12 && x <= 24 && Math.abs(y - 15.5) <= (24 - x) * (9 / 12) + 0.5 && x >= 12;
      const i = (y * size + x) * 4;
      if (!inside) continue;
      const t = y / size;
      const [rr, gg, bb] = tri ? [255, 255, 255] : [Math.round(124 - 40 * t), Math.round(108 - 20 * t), Math.round(255 - 40 * t)];
      buf[i] = bb; buf[i + 1] = gg; buf[i + 2] = rr; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

let traySignature = '';
function updateTray() {
  if (!tray) return;
  const projector = displays.findProjector(settings);
  const matchName = settings.projector.match || 'projector';
  const on = state.mode !== 'off';
  const signature = JSON.stringify([on, projector?.id, projector?.label, matchName, settings.autoTvMode, settings.audio.switchToProjector, settings.runAtStartup, state.firewallBlocked]);
  if (signature === traySignature) return;
  traySignature = signature;
  const startup = app.getLoginItemSettings(loginItemSettings()).openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: on ? 'TV mode is on' : 'TV mode is off', enabled: false },
    { label: projector ? `Projector found: ${projector.label || 'display'}` : `Projector "${matchName}" not detected`, enabled: false },
    { type: 'separator' },
    on
      ? { label: 'Go to TV home', click: () => goHome() }
      : { label: 'Start TV mode now', click: () => handleRemote({ t: 'enter' }) },
    { label: 'Exit TV mode', enabled: on, click: () => exitTvMode({ suppress: true }) },
    { type: 'separator' },
    {
      label: 'Start TV mode when the projector connects',
      type: 'checkbox',
      checked: settings.autoTvMode,
      click: (item) => { settings.autoTvMode = item.checked; cfg.saveSettings(settings); if (item.checked) scheduleEvaluate(100); }
    },
    {
      label: 'Switch sound to the projector',
      type: 'checkbox',
      checked: settings.audio.switchToProjector,
      click: (item) => { settings.audio.switchToProjector = item.checked; cfg.saveSettings(settings); }
    },
    {
      label: 'Launch at Windows startup',
      type: 'checkbox',
      checked: startup,
      click: (item) => {
        settings.runAtStartup = item.checked;
        cfg.saveSettings(settings);
        app.setLoginItemSettings(loginItemSettings(item.checked));
      }
    },
    { type: 'separator' },
    { label: state.firewallBlocked ? 'Fix phone connection (Windows Firewall)  <- phone is blocked' : 'Phone can\'t connect? Fix Windows Firewall...', click: () => fixFirewall() },
    { label: 'Copy phone remote link', click: () => clipboard.writeText(remote.stableUrl() || remote.urls()[0]) },
    { label: 'Edit tiles (tiles.json)', click: () => shell.openPath(path.join(cfg.ROOT, 'tiles.json')) },
    { label: 'Reload tiles', click: () => { tiles = cfg.loadTiles(); loadIcons(); pushState(); } },
    {
      label: 'TV browser: sign in / manage passwords',
      click: () => {
        try { browser.openSetupWindow(); } catch (err) { toast(err.message); }
      }
    },
    { type: 'separator' },
    { label: 'Quit Lumen TV', click: () => quit() }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(on ? 'Lumen TV: TV mode on' : 'Lumen TV');
}

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  await exitTvMode({}).catch(() => {});
  volume?.stop();
  volumeOverlay?.close();
  if (remote) remote.stop();
  app.exit(0);
}

// ---------------------------------------------------------------- tile icons

async function loadIcons() {
  if (!settings.fetchIcons) return;
  fs.mkdirSync(ICON_DIR, { recursive: true });
  for (const tile of tiles) {
    const file = path.join(ICON_DIR, `${tile.id.replace(/[^\w-]/g, '_')}.png`);
    if (!fs.existsSync(file) && tile.url) {
      try {
        const domain = new URL(tile.url).hostname;
        const res = await net.fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
        if (res.ok) fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        log('icon fetch failed for', tile.id, err.message);
      }
    }
    if (fs.existsSync(file)) state.icons[tile.id] = `${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`;
  }
  pushState();
}

// ---------------------------------------------------------------- startup

app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('second-instance', () => {
  if (state.mode === 'off') handleRemote({ t: 'enter' });
  else goHome();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  settings = cfg.loadSettings();
  tiles = cfg.loadTiles();
  volume=new VolumeMonitor();
  volumeOverlay=new VolumeOverlay({autoHide:settings.audio.volumeAutoHide !== false});
  volumeOverlay.on('visibility',()=>pushState().catch(()=>{}));
  volume.on('snapshot',snapshot=>{
    const previous=state.volume;state.volume=snapshot;
    const changed=JSON.stringify(previous)!==JSON.stringify(snapshot);
    if(state.mode!=='off'&&previous&&changed)volumeOverlay.show(state.display,snapshot);
    if(changed)pushState().catch(err=>log('could not publish volume:',err.message));
  });
  volume.on('unavailable',()=>{if(state.volume){state.volume=null;pushState().catch(()=>{});}});

  browser = new TvBrowser({
    edgePath: settings.browser.path,
    debugPort: settings.browser.debugPort,
    profileDir: path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'LumenTV', 'edge-profile'),
    mediaKey: () => input.tap('PlayPause')
  });
  browser.on('title', () => pushState());
  browser.on('home-requested', () => goHome());
  let lastRedirectWarning = 0;
  browser.on('navigation-blocked', () => {
    if (Date.now()-lastRedirectWarning < 4000) return;
    lastRedirectWarning = Date.now();
    toast('Blocked an unrelated redirect. Use More > Sign in to current app for external sign-in.');
  });
  browser.on('closed', () => {
    state.media = null;
    state.input = null;
    state.focus = null;
    state.controls = {};
    mediaSignature = '';
    if (state.mode === 'app') goHome();
    else pushState();
  });

  remote = new RemoteServer({ ...settings.remote, host: process.env.LUMEN_REMOTE_HOST || settings.remote.host });
  remote.on('message', (msg) => handleRemote(msg).catch((err) => log('remote command failed:', err)));
  remote.on('clients', (n) => { state.clients = n; pushState(); });
  remote.on('connected', (ws) => viewState().then((s) => remote.send(ws, remoteState(s))));
  try {
    await remote.start();
    remote.startHeartbeat();
    log('phone remote:', remote.urls().join('  '));
    checkFirewall().catch((err) => log('firewall check failed:', err.message));
  } catch (err) {
    log('could not start the phone remote:', err.message);
  }

  tray = new Tray(makeTrayIcon());
  tray.on('click', () => (state.mode === 'off' ? handleRemote({ t: 'enter' }) : goHome()));

  ipcMain.on('ui-ready', () => pushState());
  ipcMain.on('launch', (_e, id) => launchTile(String(id)));
  ipcMain.on('action', (_e, name, arg) => {
    if (name === 'exit') exitTvMode({ suppress: true });
    else if (name === 'resume') resumeApp();
    else if (name === 'closeapp') closeApp();
    else if (name === 'sleep') setSleep(Number(arg) || 0);
  });

  screen.on('display-added', () => scheduleEvaluate());
  screen.on('display-removed', () => scheduleEvaluate());
  screen.on('display-metrics-changed', () => scheduleEvaluate(800));
  setInterval(evaluateDisplays, 8000);
  setInterval(syncMediaState, 650);

  if (process.platform === 'win32' && !DEV) {
    app.setLoginItemSettings(loginItemSettings(settings.runAtStartup !== false));
  }

  updateTray();
  bg(refreshAudioDevices());
  loadIcons();
  evaluateDisplays();
  log('Lumen TV is running', DEV ? '(dev mode)' : '');
});

app.on('will-quit', () => globalShortcut.unregisterAll());
