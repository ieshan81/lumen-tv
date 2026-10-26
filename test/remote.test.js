'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');
const { RemoteServer } = require('../src/remote');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('remote requires authentication and accepts a paired WebSocket', async (t) => {
  const port = await freePort();
  const token = 'professional-test-token';
  const remote = new RemoteServer({ host: '127.0.0.1', port, token });
  await remote.start();
  t.after(() => remote.stop());

  const denied = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(denied.status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/haptics.js`)).status,401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/haptics.js?t=${token}`)).status,200);
  const malformed = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie:'lumen=%broken' } });
  assert.equal(malformed.status,401);

  const paired = await fetch(`http://127.0.0.1:${port}/?t=${token}`);
  assert.equal(paired.status, 200);
  assert.match(await paired.text(), /Start Lumen/);
  assert.ok(paired.headers.get('set-cookie').includes('HttpOnly'));

  const connected = new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`);
    socket.once('open', () => { socket.close(); resolve(); });
    socket.once('error', reject);
  });
  await connected;
});
