'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalize } = require('../src/catalog');
const { WatchHistory, parseMovyUrl } = require('../src/watch-history');
const { AssistantEngine, parseIntent } = require('../src/assistant');

test('catalog metadata becomes Movy-ready cinematic content', () => {
  const item = normalize({ id: 99, media_type:'movie', title:'A Film', release_date:'2026-01-01', vote_average:8.25, backdrop_path:'/hero.jpg', poster_path:'/poster.jpg' });
  assert.equal(item.ref, 'movie:99');
  assert.equal(item.url, 'https://www.movy.sx/movie/99?play=true');
  assert.equal(item.backdrop, 'https://image.tmdb.org/t/p/w1280/hero.jpg');
});

test('Movy episodes are parsed and Continue Watching survives restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-history-'));
  const file = path.join(dir, 'history.json');
  const parsed = parseMovyUrl('https://www.movy.sx/tv/1434/7/8?play=true');
  assert.deepEqual({ref:parsed.ref,season:parsed.season,episode:parsed.episode},{ref:'tv:1434',season:7,episode:8});
  const history = new WatchHistory({ file, writeIntervalMs:0 });
  assert.equal(history.capture({ tileId:'movy', url:'https://www.movy.sx/tv/1434/7/8', title:'Family Guy', media:{title:'Family Guy',series:'Family Guy',currentTime:601,duration:1320,season:7,episode:8} }), true);
  history.flush();
  const restored = new WatchHistory({ file });
  assert.equal(restored.find('family guy').position, 601);
  fs.rmSync(dir, { recursive:true, force:true });
});

test('Jarvis parses recommendation, YouTube and resume requests without an LLM', async () => {
  assert.deepEqual(parseIntent('Yo Jarvis, I feel like watching something horror Indonesian'), { type:'recommend', genre:'horror', country:'indonesian', language:'indonesian', mediaType:'movie', query:'I feel like watching something horror Indonesian' });
  assert.equal(parseIntent('did Mrwhosetheboss put anything on YouTube').type, 'youtube');
  assert.deepEqual(parseIntent('continue our Family Guy episode'), { type:'continue', query:'family guy' });
  const catalog = { discover: async request => [{ref:'movie:1',title:'Night'}], search:async()=>[] };
  const history = { find: query => query.toLowerCase().includes('family') ? {title:'Family Guy',position:300,url:'https://www.movy.sx/tv/1434/7/8'} : null, publicItems:()=>[] };
  const assistant = new AssistantEngine({ catalog, history });
  assert.equal((await assistant.resolve('Yo Jarvis horror Indonesian')).action, 'recommend');
  assert.equal((await assistant.resolve('continue Family Guy')).action, 'resume');
  assert.match((await assistant.resolve('did Mrwhosetheboss upload on YouTube')).url, /youtube\.com\/results/);
});
