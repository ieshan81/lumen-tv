'use strict';
// Serves the phone remote page and relays its commands. Protected by a secret token that is part of
// the link shown on the TV (a QR code), so only someone who can see the projector can connect.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..', 'remote');
// [file, content type, public?, contains the secret token to fill in?]
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8', false, true],
  '/remote.css': ['remote.css', 'text/css; charset=utf-8', false, false],
  '/remote.js': ['remote.js', 'text/javascript; charset=utf-8', false, false],
  '/haptics.js': ['haptics.js', 'text/javascript; charset=utf-8', false, false],
  '/picture-math.js': ['picture-math.js', 'text/javascript; charset=utf-8', false, false],
  '/calibration-ui.js': ['calibration-ui.js', 'text/javascript; charset=utf-8', false, false],
  '/calibration.css': ['calibration.css', 'text/css; charset=utf-8', false, false],
  '/outfit.woff2': ['../ui/fonts/outfit-latin-wght-normal.woff2', 'font/woff2', false, false],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json', false, true],
  // icons hold no secrets, and iOS fetches them without cookies when saving to the Home Screen
  '/icon.svg': ['icon.svg', 'image/svg+xml', true, false],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png', true, false]
};

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|vbox|wsl|hyper-v|loopback|bluetooth|tailscale|zerotier/i.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const wifi = /wi-?fi|wlan|wireless/i.test(name);
      found.push({ address: a.address, score: (wifi ? 2 : 0) + (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address) ? 1 : 0) });
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.address);
}

class RemoteServer extends EventEmitter {
  constructor({ host, port, token }) {
    super();
    this.host = host;
    this.port = port;
    this.token = token;
    this.clients = new Set();
  }

  _authed(req) {
    const url = new URL(req.url, 'http://x');
    if (safeEqual(url.searchParams.get('t') || '', this.token)) return 'query';
    const cookie = /(?:^|;\s*)lumen=([^;]+)/.exec(req.headers.cookie || '');
    try { if (cookie && safeEqual(decodeURIComponent(cookie[1]), this.token)) return 'cookie'; } catch { /* malformed cookie is unauthenticated */ }
    return null;
  }

  start() {
    this.http = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const iconId = /^\/tile-icon\/([\w-]+)$/.exec(url.pathname);
      if (iconId && this._authed(req)) {
        const iconFile = path.join(__dirname, '..', 'cache', 'icons', `${iconId[1]}.png`);
        fs.readFile(iconFile, (err, body) => {
          if (err) {
            res.writeHead(404);
            return res.end();
          }
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          res.end(body);
        });
        return;
      }
      const file = FILES[url.pathname];
      const how = this._authed(req) || (file && file[2] ? 'public' : null);
      if (!file || !how) {
        res.writeHead(how ? 404 : 401, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(how ? 'Not found' : 'Open the link or QR code shown on the TV screen.');
      }
      fs.readFile(path.join(ROOT, file[0]), (err, body) => {
        if (err) {
          res.writeHead(404);
          return res.end();
        }
        // The home-screen shortcut must reopen with the token, so it is written into the page and manifest.
        if (file[3]) body = Buffer.from(body.toString('utf8').split('__TOKEN__').join(encodeURIComponent(this.token)));
        const headers = { 'content-type': file[1], 'cache-control': file[2] ? 'public, max-age=86400' : 'no-store', 'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff' };
        if (how === 'query') {
          headers['set-cookie'] = `lumen=${encodeURIComponent(this.token)}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly`;
        }
        res.writeHead(200, headers);
        res.end(body);
      });
    });

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
    this.http.on('upgrade', (req, socket, head) => {
      if (new URL(req.url, 'http://x').pathname !== '/ws' || !this._authed(req)) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this._onClient(ws));
    });

    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, this.host, () => resolve());
    });
  }

  _onClient(ws) {
    this.clients.add(ws);
    this.emit('clients', this.clients.size);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg && typeof msg.t === 'string') this.emit('message', msg, ws);
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      this.emit('clients', this.clients.size);
    });
    this.emit('connected', ws);
  }

  /** Drop dead phone connections (screen locked, left Wi-Fi) so the "connected" indicator stays honest. */
  startHeartbeat() {
    this.beat = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }, 10000);
  }

  send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(data);
  }

  urls() {
    const hosts = lanAddresses();
    if (!hosts.length) hosts.push('localhost');
    return hosts.map((h) => `http://${h}:${this.port}/?t=${this.token}`);
  }

  /** Address based on the computer's name, which keeps working when the router hands out a new IP. */
  stableUrl() {
    const name = os.hostname();
    return name ? `http://${name}.local:${this.port}/?t=${this.token}` : '';
  }

  stop() {
    clearInterval(this.beat);
    for (const ws of this.clients) ws.terminate();
    if (this.http) this.http.close();
  }
}

module.exports = { RemoteServer, lanAddresses };
