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
const ciao = require('@homebridge/ciao');

const ROOT = path.join(__dirname, '..', 'remote');
// [file, content type, public?, contains the secret token to fill in?]
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8', false, true],
  '/remote.css': ['remote.css', 'text/css; charset=utf-8', false, false],
  '/remote.js': ['remote.js', 'text/javascript; charset=utf-8', false, false],
  '/haptics.js': ['haptics.js', 'text/javascript; charset=utf-8', false, false],
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
  constructor({ host, port, token, discovery = true }) {
    super();
    this.host = host;
    this.port = port;
    this.token = token;
    this.discovery = discovery && !String(host).startsWith('127.');
    this.clients = new Set();
    // Fingerprint of the phone page, so an already-open remote can tell when the laptop has a newer one.
    this.buildId = crypto.createHash('sha1').update(['index.html', 'remote.css', 'remote.js', 'haptics.js'].map((name) => { try { return fs.readFileSync(path.join(ROOT, name)); } catch { return ''; } }).join('\0')).digest('hex').slice(0, 12);
    this.advertisedHost = '';
    this.starting = null;
    this.stopping = false;
  }

  _authed(req) {
    const url = new URL(req.url, 'http://x');
    if (safeEqual(url.searchParams.get('t') || '', this.token)) return 'query';
    const cookie = /(?:^|;\s*)lumen=([^;]+)/.exec(req.headers.cookie || '');
    try { if (cookie && safeEqual(decodeURIComponent(cookie[1]), this.token)) return 'cookie'; } catch { /* malformed cookie is unauthenticated */ }
    return null;
  }

  start() {
    if (this.http?.listening) return Promise.resolve();
    if (this.starting) return this.starting;
    this.stopping = false;
    this.http = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({ ok: true, clients: this.clients.size }));
      }
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
        if (file[3]) body = Buffer.from(body.toString('utf8').split('__TOKEN__').join(encodeURIComponent(this.token)).split('__BUILD__').join(this.buildId));
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

    const server = this.http;
    this.starting = new Promise((resolve, reject) => {
      const startupError = error => reject(error);
      server.once('error', startupError);
      server.listen(this.port, this.host, async () => {
        server.removeListener('error', startupError);
        server.on('error', error => this.emit('offline', error));
        server.on('close', () => { if (!this.stopping) this.emit('offline', new Error('Phone remote server closed.')); });
        try { await this._advertise(); }
        catch (error) { this.emit('discovery-error', error); }
        this.emit('online');
        resolve();
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async _advertise() {
    if (!this.discovery || this.service) return;
    this.responder = ciao.getResponder();
    this.service = this.responder.createService({
      name: 'Lumen Remote',
      type: 'http',
      port: this.port,
      hostname: 'lumen',
      disabledIpv6: true,
      txt: { path: '/', app: 'lumen-tv' }
    });
    this.service.on('hostname-change', hostname => {
      this.advertisedHost = String(hostname || '').replace(/\.$/, '');
      this.emit('address', this.stableUrl());
    });
    await this.service.advertise();
    this.advertisedHost = String(this.service.getHostname() || 'lumen.local').replace(/\.$/, '');
    this.emit('address', this.stableUrl());
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
    clearInterval(this.beat);
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

  /** mDNS address advertised by Lumen, so a saved phone shortcut survives DHCP address changes. */
  stableUrl() {
    const name = this.advertisedHost || (this.discovery ? 'lumen.local' : '');
    return name ? `http://${name}:${this.port}/?t=${this.token}` : '';
  }

  pairingUrl() { return this.stableUrl() || this.urls()[0] || ''; }
  isListening() { return !!this.http?.listening; }

  stop() {
    this.stopping = true;
    clearInterval(this.beat);
    for (const ws of this.clients) ws.terminate();
    if (this.http) this.http.close();
    this.clients.clear();
    const responder = this.responder;
    this.service = null;
    this.responder = null;
    this.advertisedHost = '';
    if (responder) Promise.resolve(responder.shutdown()).catch(() => {});
  }
}

module.exports = { RemoteServer, lanAddresses };
