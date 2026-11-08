'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Catalog, normalize, selectLogo } = require('../src/catalog');
const { WatchHistory, parseMovyUrl } = require('../src/watch-history');
const { AssistantEngine, parseIntent } = require('../src/assistant');

test('catalog metadata becomes Movy-ready cinematic content', () => {
  const item = normalize({ id: 99, media_type:'movie', title:'A Film', release_date:'2026-01-01', vote_average:8.25, backdrop_path:'/hero.jpg', poster_path:'/poster.jpg' });
  assert.equal(item.ref, 'movie:99');
  assert.equal(item.url, 'https://www.movy.sx/movie/99?play=true');
  assert.equal(item.backdrop, 'https://image.tmdb.org/t/p/w1280/hero.jpg');
});

test('catalog fetches and ranks transparent title artwork for movies and series', async () => {
  const chosen = selectLogo([
    { file_path:'/plain.png', iso_639_1:null, vote_average:9, vote_count:50, width:1200 },
    { file_path:'/english.png', iso_639_1:'en', vote_average:7, vote_count:2, width:900 }
  ]);
  assert.equal(chosen.file_path, '/english.png');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-catalog-'));
  const requests = [];
  const fetchImpl = async url => {
    requests.push(String(url));
    if (url.pathname.endsWith('/trending/all/week')) return { ok:true, json:async()=>({ results:[
      { id:99, media_type:'movie', title:'A Film', release_date:'2026-01-01', backdrop_path:'/hero.jpg' },
      { id:77, media_type:'tv', name:'A Series', first_air_date:'2025-01-01', backdrop_path:'/series.jpg' }
    ] }) };
    return { ok:true, json:async()=>({ logos:[{ file_path:url.pathname.includes('/movie/')?'/movie-logo.png':'/series-logo.png', iso_639_1:'en', width:1000 }] }) };
  };
  const catalog = new Catalog({ root:dir, fetchImpl, cacheFile:path.join(dir, 'catalog.json') });
  catalog.token = 'fixture-token';
  const state = await catalog.refresh();
  assert.equal(state.featured[0].logo, 'https://image.tmdb.org/t/p/w500/movie-logo.png');
  assert.equal(state.featured[1].logo, 'https://image.tmdb.org/t/p/w500/series-logo.png');
  assert.ok(state.featured.every(item => item.logoChecked));
  assert.equal(requests.filter(url => /\/(movie|tv)\/\d+\/images/.test(url)).length, 2);
  assert.ok(requests.filter(url => url.includes('/images')).every(url => url.includes('include_image_language=en%2Cnull') && !url.includes('language=en-US')));
  fs.rmSync(dir, { recursive:true, force:true });
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

test('a blank Movy rail image cannot erase enriched Continue Watching art', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-history-art-'));
  const file = path.join(dir, 'history.json');
  const history = new WatchHistory({ file, writeIntervalMs:0 });
  history.items = [{ key:'movie:1384216::', ref:'movie:1384216', url:'https://www.movy.sx/movie/1384216?play=true', title:'The Dog Stars', position:478, duration:7136, progress:.067, artwork:'https://image.tmdb.org/t/p/w1280/dog-stars.jpg', updatedAt:1 }];
  assert.equal(history.merge([{ key:'movie:1384216::', ref:'movie:1384216', url:'https://www.movy.sx/movie/1384216?play=true', title:'The Dog Stars', position:480, duration:7136, progress:.0672, artwork:'', updatedAt:2 }]), true);
  assert.equal(history.publicItems()[0].artwork, 'https://image.tmdb.org/t/p/w1280/dog-stars.jpg');
  fs.rmSync(dir, { recursive:true, force:true });
});

test('Continue Watching shows each show once, using its latest unfinished episode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-history-dedupe-'));
  const history = new WatchHistory({ file:path.join(dir, 'history.json'), writeIntervalMs:0 });
  const entry = (ref, season, episode, progress, updatedAt, extra = {}) => ({ key:`${ref}:${season ?? ''}:${episode ?? ''}`, ref, season, episode, title:ref, url:`https://www.movy.sx/${ref.replace(':', '/')}`, position:progress * 1000, duration:1000, progress, updatedAt, ...extra });
  history.items = [
    entry('tv:289517', 1, 4, .56, 90), entry('tv:1434', 10, 7, 1, 80), entry('tv:289517', 1, 3, .05, 70),
    entry('tv:1434', 10, 5, .13, 60), entry('movie:1384216', null, null, .09, 50), entry('tv:289517', 1, 2, .87, 40),
    entry('tv:1434', 9, 18, .8, 30), entry('jojo:naruto', 1, 2, .3, 20, { series:'Naruto' }), entry('jojo:naruto-episode-1', 1, 1, .4, 10, { series:'Naruto' })
  ];
  const shown = history.publicItems();
  assert.deepEqual(shown.map(item => item.key), ['tv:289517:1:4', 'tv:1434:10:5', 'movie:1384216::', 'jojo:naruto:1:2']);
  assert.equal(history.items.length, 9, 'every episode keeps its own saved position');
  assert.equal(history.publicItems(2).length, 2);
  assert.equal(history.find('tv 289517').key, 'tv:289517:1:4', '"continue" resolves to the same episode the rail shows');
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
