'use strict';
// Real keyboard/mouse input via user32, so the phone remote works in any window (Edge, VLC, ...).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *p)');
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
const mouse_event = user32.func('void __stdcall mouse_event(uint32 flags, uint32 dx, uint32 dy, uint32 data, uintptr_t extra)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)');

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t'
});
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t'
});
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  u: koffi.union('INPUT_U', { ki: KEYBDINPUT, mi: MOUSEINPUT })
});
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 n, INPUT *inputs, int size)');

// ---- window focus (Windows blocks background processes from taking the foreground, so work around it)
const kernel32 = koffi.load('kernel32.dll');
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');
const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void *hwnd, intptr_t lparam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(WNDENUMPROC *cb, intptr_t lparam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void *hwnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(void *hwnd)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(void *hwnd, int cmd)');
const IsIconic = user32.func('bool __stdcall IsIconic(void *hwnd)');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 from, uint32 to, bool attach)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hwnd, _Out_ uint8_t *buf, int n)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ RECT *r)');

const SwitchToThisWindow = user32.func('void __stdcall SwitchToThisWindow(void *hwnd, bool altTab)');

const KEYUP = 0x2;
const EXTENDED = 0x1;
const UNICODE = 0x4;

// name -> [virtual key, extended?]
const KEYS = {
  Left: [0x25, 1], Up: [0x26, 1], Right: [0x27, 1], Down: [0x28, 1],
  Home: [0x24, 1], End: [0x23, 1], PageUp: [0x21, 1], PageDown: [0x22, 1], Delete: [0x2e, 1],
  Enter: [0x0d, 0], Esc: [0x1b, 0], Backspace: [0x08, 0], Space: [0x20, 0], Tab: [0x09, 0],
  F: [0x46, 0], M: [0x4d, 0], J: [0x4a, 0], L: [0x4c, 0], K: [0x4b, 0],
  VolUp: [0xaf, 0], VolDown: [0xae, 0], Mute: [0xad, 0],
  PlayPause: [0xb3, 0], Next: [0xb0, 0], Prev: [0xb1, 0],
  Alt: [0x12, 0], Ctrl: [0x11, 0], Shift: [0x10, 0]
};

function keyEvent(vk, ext, up) {
  keybd_event(vk, 0, (ext ? EXTENDED : 0) | (up ? KEYUP : 0), 0);
}

/** Press and release a named key, optionally with modifiers held ("Alt", "Ctrl", "Shift"). */
function tap(name, mods = []) {
  const key = KEYS[name];
  if (!key) return false;
  const held = mods.map((m) => KEYS[m]).filter(Boolean);
  for (const [vk] of held) keyEvent(vk, 0, false);
  keyEvent(key[0], key[1], false);
  keyEvent(key[0], key[1], true);
  for (const [vk] of held.reverse()) keyEvent(vk, 0, true);
  return true;
}

function sendUnicode(codeUnit, up) {
  SendInput(
    1,
    { type: 1, u: { ki: { wVk: 0, wScan: codeUnit, dwFlags: UNICODE | (up ? KEYUP : 0), time: 0, dwExtraInfo: 0 } } },
    koffi.sizeof(INPUT)
  );
}

function typeText(text) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    sendUnicode(unit, false);
    sendUnicode(unit, true);
  }
}

// Optional rectangle (physical pixels) that the cursor is kept inside, e.g. the projector.
let clamp = null;

function setClamp(rect) {
  clamp = rect;
}

function cursor() {
  const p = {};
  GetCursorPos(p);
  return { x: p.x, y: p.y };
}

function moveTo(x, y) {
  if (clamp) {
    x = Math.min(Math.max(x, clamp.x), clamp.x + clamp.width - 1);
    y = Math.min(Math.max(y, clamp.y), clamp.y + clamp.height - 1);
  }
  SetCursorPos(Math.round(x), Math.round(y));
}

function moveBy(dx, dy) {
  const p = cursor();
  moveTo(p.x + dx, p.y + dy);
}

function center() {
  if (clamp) moveTo(clamp.x + clamp.width / 2, clamp.y + clamp.height / 2);
}

const BUTTONS = { left: [0x2, 0x4], right: [0x8, 0x10] };

function click(button = 'left', double = false) {
  const [down, up] = BUTTONS[button] || BUTTONS.left;
  for (let i = 0; i < (double ? 2 : 1); i++) {
    mouse_event(down, 0, 0, 0, 0);
    mouse_event(up, 0, 0, 0, 0);
  }
}

function mouseButton(button, isDown) {
  const [down, up] = BUTTONS[button] || BUTTONS.left;
  mouse_event(isDown ? down : up, 0, 0, 0, 0);
}

/** Positive = scroll content down (like a finger swiping up). */
function scroll(notches) {
  const delta = Math.round(-notches * 120);
  mouse_event(0x800, 0, 0, delta >>> 0, 0);
}

function pidOf(hwnd) {
  const out = [0];
  const thread = GetWindowThreadProcessId(hwnd, out);
  return { pid: out[0], thread };
}

function className(hwnd) {
  const buf = Buffer.alloc(512);
  const n = GetClassNameW(hwnd, buf, 256);
  return buf.toString('utf16le', 0, n * 2);
}

/** Largest visible top-level window owned by a process (the browser window, not its helpers). */
function mainWindowOf(pid) {
  let best = null;
  const cb = koffi.register((hwnd) => {
    if (!IsWindowVisible(hwnd) || pidOf(hwnd).pid !== pid) return true;
    const r = {};
    GetWindowRect(hwnd, r);
    const area = Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
    if (area > 0 && (!best || area > best.area)) best = { hwnd, area };
    return true;
  }, koffi.pointer(WNDENUMPROC));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return best && best.hwnd;
}

function foregroundPid() {
  const fg = GetForegroundWindow();
  return fg ? pidOf(fg).pid : 0;
}

/** What we know about the focus situation, for the log when focusing fails. */
function describeFocus(pid) {
  const hwnd = mainWindowOf(pid);
  const fg = GetForegroundWindow();
  return `window=${hwnd ? 'found' : 'MISSING'} minimised=${hwnd ? IsIconic(hwnd) : '-'} foregroundPid=${foregroundPid()} foregroundClass=${fg ? className(fg) : '-'}`;
}

/**
 * Bring the main window of a process to the foreground, even when we are not the foreground app.
 * Windows blocks that for background processes, so escalate through the usual workarounds.
 */
function focusProcess(pid, { aggressive = false } = {}) {
  const hwnd = mainWindowOf(pid);
  if (!hwnd) return false;
  if (foregroundPid() === pid) return true;
  if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE

  // 1. share the foreground app's input queue for a moment
  const fg = GetForegroundWindow();
  const fgThread = fg ? pidOf(fg).thread : 0;
  const me = GetCurrentThreadId();
  const attached = fgThread && fgThread !== me ? AttachThreadInput(me, fgThread, true) : false;
  try {
    keybd_event(0x87, 0, 0, 0); // F24: a harmless key that still counts as input
    keybd_event(0x87, 0, KEYUP, 0);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
  } finally {
    if (attached) AttachThreadInput(me, fgThread, false);
  }
  if (foregroundPid() === pid) return true;

  // 2. the Alt key hack
  keybd_event(0x12, 0, 0, 0);
  keybd_event(0x12, 0, KEYUP, 0);
  SetForegroundWindow(hwnd);
  if (foregroundPid() === pid) return true;

  // 3. what Alt+Tab uses
  SwitchToThisWindow(hwnd, true);
  if (foregroundPid() === pid) return true;

  // 4. minimise and restore (visible flicker, so only when the caller really needs it)
  if (!aggressive) return false;
  ShowWindow(hwnd, 6); // SW_MINIMIZE
  ShowWindow(hwnd, 9); // SW_RESTORE
  SetForegroundWindow(hwnd);
  return foregroundPid() === pid;
}

module.exports = { focusProcess, foregroundPid, describeFocus, tap, typeText, setClamp, cursor, moveTo, moveBy, center, click, mouseButton, scroll, KEYS };
