'use strict';
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

class JarvisListener extends EventEmitter {
  constructor({ root, enabled = true } = {}) {
    super(); this.root = root || path.join(__dirname, '..'); this.enabled = enabled; this.child = null;
    this.state = { status: enabled ? 'idle' : 'disabled', listening: false, armed: false, error: '', lastHeard: '' };
  }
  publicState() { return { ...this.state }; }
  start() {
    if (!this.enabled || process.platform !== 'win32' || this.child) return;
    this.state = { ...this.state, status: 'starting', error: '' }; this.emit('change');
    const script = path.join(this.root, 'scripts', 'jarvis-listener.ps1');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child; let pending = '';
    child.stdout.on('data', chunk => {
      pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'ready') this.state = { ...this.state, status: 'ready', listening: true, error: '' };
        if (event.type === 'speech') { this.state = { ...this.state, lastHeard: event.text || '' }; this.emit('speech', event.text || ''); }
        if (event.type === 'error') this.state = { ...this.state, status: 'error', listening: false, error: event.message || 'Speech recognition failed' };
        this.emit('change');
      }
    });
    child.once('error', error => { this.state = { ...this.state, status: 'error', listening: false, error: error.message }; this.child = null; this.emit('change'); });
    child.once('exit', () => { if (this.child === child) this.child = null; if (this.enabled) this.state = { ...this.state, status: 'idle', listening: false }; this.emit('change'); });
  }
  stop() { if (this.child) { this.child.stdin.end('quit\n'); setTimeout(() => this.child?.kill(), 500); this.child = null; } this.state = { ...this.state, status: this.enabled ? 'idle' : 'disabled', listening: false, armed: false }; this.emit('change'); }
  arm() { this.state.armed = true; this.state.status = this.child ? 'ready' : 'starting'; this.emit('change'); this.start(); }
  disarm() { this.state.armed = false; this.emit('change'); }
}

module.exports = { JarvisListener };
