'use strict';
(function initialiseHearth(root) {
  const DEFAULT_PRIMARY = [224, 117, 52];
  const DEFAULT_ACCENT = [255, 198, 126];

  const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
  const mix = (from, to, amount) => from.map((value, index) => clamp(value + (to[index] - value) * amount));

  function paletteFromPixels(pixels, width, height) {
    let red = 0, green = 0, blue = 0, total = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (pixels[offset + 3] < 180) continue;
        const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
        const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
        const luminance = (r * .2126) + (g * .7152) + (b * .0722);
        if (luminance < 18 || luminance > 242) continue;
        const saturation = maximum ? (maximum - minimum) / maximum : 0;
        const edge = x < width * .22 || x > width * .78;
        const lower = y > height * .52;
        const weight = .22 + saturation * 1.35 + (edge ? .28 : 0) + (lower ? .42 : 0);
        red += r * weight; green += g * weight; blue += b * weight; total += weight;
      }
    }
    if (!total) return { primary: DEFAULT_PRIMARY.slice(), accent: DEFAULT_ACCENT.slice() };
    const sampled = [red / total, green / total, blue / total];
    return {
      primary: mix(sampled, [238, 103, 37], .3),
      accent: mix(sampled, [255, 218, 162], .56)
    };
  }

  function paletteFromImage(image) {
    const sampler = root.document.createElement('canvas');
    sampler.width = 48; sampler.height = 27;
    const context = sampler.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(sampler.width / image.naturalWidth, sampler.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (sampler.width - width) / 2, (sampler.height - height) / 2, width, height);
    const frame = context.getImageData(0, 0, sampler.width, sampler.height);
    return paletteFromPixels(frame.data, frame.width, frame.height);
  }

  const exported = { paletteFromPixels, mix };
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (!root || !root.document) return;

  const canvas = root.document.getElementById('hearth');
  if (!canvas) return;
  const context = canvas.getContext('2d', { alpha: true });
  const cache = new Map();
  const palette = {
    currentPrimary: DEFAULT_PRIMARY.slice(), currentAccent: DEFAULT_ACCENT.slice(),
    targetPrimary: DEFAULT_PRIMARY.slice(), targetAccent: DEFAULT_ACCENT.slice()
  };
  const embers = [];
  let width = 0, height = 0, lastFrame = 0, phase = 0, artworkRequest = 0, cssFrame = 0;

  function resize() {
    width = Math.min(960, Math.max(480, root.innerWidth || 960));
    height = Math.round(width * (root.innerHeight || 540) / Math.max(1, root.innerWidth || 960));
    canvas.width = width; canvas.height = height;
    embers.length = 0;
    for (let index = 0; index < 52; index += 1) embers.push(makeEmber(true));
  }

  function makeEmber(initial = false) {
    const edgeBias = Math.random();
    const x = edgeBias < .42 ? Math.random() * width * .3 : edgeBias > .58 ? width * (.7 + Math.random() * .3) : Math.random() * width;
    return {
      x, y: initial ? height * (.68 + Math.random() * .35) : height + Math.random() * 12,
      vx: (Math.random() - .5) * 7, vy: -(11 + Math.random() * 22),
      radius: .45 + Math.random() * 1.45, age: initial ? Math.random() * 4 : 0,
      life: 2.1 + Math.random() * 3.2, wobble: Math.random() * Math.PI * 2
    };
  }

  function resetEmber(ember) { Object.assign(ember, makeEmber(false)); }
  function rgb(values, alpha) { return `rgba(${values.map(clamp).join(',')},${alpha})`; }

  function drawGlow(x, radius, strength) {
    const gradient = context.createRadialGradient(x, height, 0, x, height, radius);
    gradient.addColorStop(0, rgb(palette.currentAccent, strength));
    gradient.addColorStop(.28, rgb(palette.currentPrimary, strength * .7));
    gradient.addColorStop(1, rgb(palette.currentPrimary, 0));
    context.fillStyle = gradient;
    context.fillRect(x - radius, height - radius, radius * 2, radius);
  }

  function drawFlame(x, baseWidth, flameHeight, alpha, lean) {
    const y = height + 3;
    const gradient = context.createLinearGradient(0, y, 0, y - flameHeight);
    gradient.addColorStop(0, rgb(palette.currentAccent, alpha));
    gradient.addColorStop(.45, rgb(palette.currentPrimary, alpha * .68));
    gradient.addColorStop(1, rgb(palette.currentPrimary, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(x - baseWidth, y);
    context.bezierCurveTo(x - baseWidth * .7, y - flameHeight * .35, x + lean, y - flameHeight * .72, x + lean * .55, y - flameHeight);
    context.bezierCurveTo(x + baseWidth * .15, y - flameHeight * .58, x + baseWidth * .78, y - flameHeight * .3, x + baseWidth, y);
    context.closePath(); context.fill();
  }

  function updatePalette(delta) {
    const amount = Math.min(1, delta * 1.65);
    for (let index = 0; index < 3; index += 1) {
      palette.currentPrimary[index] += (palette.targetPrimary[index] - palette.currentPrimary[index]) * amount;
      palette.currentAccent[index] += (palette.targetAccent[index] - palette.currentAccent[index]) * amount;
    }
    if ((cssFrame += 1) % 3 === 0) {
      root.document.documentElement.style.setProperty('--hearth-primary', palette.currentPrimary.map(clamp).join(' '));
      root.document.documentElement.style.setProperty('--hearth-accent', palette.currentAccent.map(clamp).join(' '));
    }
  }

  function draw(timestamp) {
    root.requestAnimationFrame(draw);
    if (root.document.hidden || root.document.documentElement.classList.contains('launcher-hidden')) { lastFrame = timestamp; return; }
    if (timestamp - lastFrame < 30) return;
    const delta = Math.min(.05, Math.max(.001, (timestamp - lastFrame) / 1000 || .016));
    lastFrame = timestamp; phase += delta; updatePalette(delta);
    context.clearRect(0, 0, width, height);
    context.save(); context.globalCompositeOperation = 'lighter';
    drawGlow(width * .12, width * .34, .19);
    drawGlow(width * .5, width * .4, .085);
    drawGlow(width * .88, width * .34, .19);
    for (let index = 0; index < 9; index += 1) {
      const spread = index / 8;
      const x = width * (.035 + spread * .93);
      const centerFade = .38 + Math.abs(spread - .5) * 1.18;
      const flicker = .72 + Math.sin(phase * (2.1 + index * .09) + index * 1.7) * .18 + Math.sin(phase * 4.3 + index) * .1;
      drawFlame(x, width * (.02 + (index % 3) * .005), height * (.105 + (index % 4) * .022) * flicker, .14 * centerFade, Math.sin(phase * 2.4 + index) * width * .014);
    }
    for (const ember of embers) {
      ember.age += delta;
      if (ember.age >= ember.life || ember.y < height * .48) { resetEmber(ember); continue; }
      ember.x += (ember.vx + Math.sin(phase * 2 + ember.wobble) * 4) * delta;
      ember.y += ember.vy * delta;
      const life = Math.sin(Math.PI * ember.age / ember.life);
      context.beginPath(); context.arc(ember.x, ember.y, ember.radius, 0, Math.PI * 2);
      context.fillStyle = rgb(palette.currentAccent, life * .56); context.fill();
    }
    context.restore();
  }

  function applyPalette(next) {
    palette.targetPrimary = next.primary.slice(); palette.targetAccent = next.accent.slice();
  }

  function setArtwork(url) {
    const request = ++artworkRequest;
    if (!url) { applyPalette({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT }); return; }
    if (cache.has(url)) { applyPalette(cache.get(url)); return; }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      if (request !== artworkRequest) return;
      try { const next = paletteFromImage(image); cache.set(url, next); applyPalette(next); }
      catch { applyPalette({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT }); }
    };
    image.onerror = () => { if (request === artworkRequest) applyPalette({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT }); };
    image.src = url;
  }

  resize(); root.addEventListener('resize', resize); root.requestAnimationFrame(draw);
  root.lumenHearth = Object.freeze({ setArtwork });
})(typeof window === 'undefined' ? null : window);
