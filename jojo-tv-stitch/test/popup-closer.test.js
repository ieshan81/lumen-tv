'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const closer = require('../lumen/popup-closer');

const MAIN = 'MAIN';

test('closes a stray page and keeps the tile window', () => {
  assert.equal(closer.shouldCloseTarget({ type: 'page', targetId: 'ad', url: 'https://ads.example/pop' }, MAIN), true);
  assert.equal(closer.shouldCloseTarget({ type: 'page', targetId: MAIN, url: 'https://watch-jojo.netlify.app/watch' }, MAIN), false);
});

test('does not close devtools, extensions, or iframe targets', () => {
  assert.equal(closer.shouldCloseTarget({ type: 'page', targetId: 'd', url: 'devtools://devtools/bundled/inspector.html' }, MAIN), false);
  assert.equal(closer.shouldCloseTarget({ type: 'page', targetId: 'e', url: 'chrome-extension://abc/popup.html' }, MAIN), false);
  assert.equal(closer.shouldCloseTarget({ type: 'iframe', targetId: 'f', url: 'https://player.videasy.to/x' }, MAIN), false);
});

test('does not close Netflix, Prime, or Disney windows', () => {
  assert.equal(closer.isProtectedUrl('https://www.netflix.com/browse'), true);
  assert.equal(closer.isProtectedUrl('https://www.primevideo.com/'), true);
  assert.equal(closer.isProtectedUrl('https://www.disneyplus.com/'), true);
  assert.equal(closer.shouldCloseTarget({ type: 'page', targetId: 'n', url: 'https://www.netflix.com/watch/1' }, MAIN), false);
  assert.equal(closer.tileWantsPopupCloser({ id: 'netflix', blockPopups: false }), false);
  assert.equal(closer.tileWantsPopupCloser({ id: 'jojo', blockPopups: true }), true);
});

test('sweep closes only extra pages', async () => {
  const closed = [];
  const cdp = {
    async send(method) {
      if (method === 'Target.getTargets') {
        return {
          targetInfos: [
            { type: 'page', targetId: MAIN, url: 'https://watch-jojo.netlify.app/' },
            { type: 'page', targetId: 'pop', url: 'https://track.example/click' },
            { type: 'iframe', targetId: 'frame', url: 'https://ythd.org/embed/1' },
            { type: 'page', targetId: 'nf', url: 'https://www.netflix.com/browse' }
          ]
        };
      }
      if (method === 'Target.closeTarget') return {};
      return {};
    }
  };
  const realSend = cdp.send.bind(cdp);
  cdp.send = async (method, params) => {
    if (method === 'Target.closeTarget') closed.push(params.targetId);
    return realSend(method, params);
  };
  const n = await closer.sweepPopups(cdp, MAIN);
  assert.equal(n, 1);
  assert.deepEqual(closed, ['pop']);
});
