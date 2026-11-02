'use strict';
const canvas = document.getElementById('halo');
const ctx = canvas.getContext('2d');
let current = { enabled: false, guide: false, intensity: .35, color: '#8b7cff', points: [] };
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 192;
sampleCanvas.height = 108;
const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
const textureCanvas = document.createElement('canvas');
textureCanvas.width = 480;
textureCanvas.height = 270;
const textureContext = textureCanvas.getContext('2d');
const ZONE_T = [.06, .17, .28, .39, .5, .61, .72, .83, .94];
let captureStream = null;
let captureVideo = null;
let captureSourceId = '';
let captureGeneration = 0;
let lastSampleAt = 0;
let liveZones = [];
let blackFrames = 0;
let publishedStatus = '';

function rgb(hex) {
  const value = parseInt(String(hex || '#000000').slice(1), 16);
  return [value >> 16, value >> 8 & 255, value & 255];
}

function mixHex(a, b, amount = .5) {
  const left = rgb(a), right = rgb(b);
  return `#${left.map((value, index) => Math.round(value + (right[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function rgba(hex, alpha) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function enhancedHex(red, green, blue) {
  const mean = (red + green + blue) / 3;
  // Projected overspill loses saturation and brightness on the wall. Calibrate
  // before temporal smoothing so dark but colorful edge detail stays visible.
  const saturation = 1.6;
  red = mean + (red - mean) * saturation;
  green = mean + (green - mean) * saturation;
  blue = mean + (blue - mean) * saturation;
  const peak = Math.max(red, green, blue);
  const gain = peak > 0 ? clamp(232 / peak, 1, 2.4) : 1;
  return `#${[red, green, blue].map(value => clamp(Math.round(value * gain), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function averagePatch(data, width, height, x, y, radius = 2) {
  let red = 0, green = 0, blue = 0, luma = 0, count = 0;
  for (let py = Math.max(0, Math.round(y) - radius); py <= Math.min(height - 1, Math.round(y) + radius); py++) {
    for (let px = Math.max(0, Math.round(x) - radius); px <= Math.min(width - 1, Math.round(x) + radius); px++) {
      const offset = (py * width + px) * 4;
      if (data[offset + 3] < 16) continue;
      red += data[offset]; green += data[offset + 1]; blue += data[offset + 2];
      luma += data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722;
      count++;
    }
  }
  return count ? { red: red / count, green: green / count, blue: blue / count, luma: luma / count } : null;
}

function sampleVideoZones() {
  if (!captureVideo || captureVideo.readyState < 2 || current.points?.length !== 4) return null;
  sampleContext.drawImage(captureVideo, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  const points = current.points.map(point => ({ x: point.x / innerWidth, y: point.y / innerHeight }));
  const center = points.reduce((out, point) => ({ x: out.x + point.x / 4, y: out.y + point.y / 4 }), { x: 0, y: 0 });
  const zones = [];
  for (let edge = 0; edge < 4; edge++) {
    const a = points[edge], b = points[(edge + 1) % 4];
    for (const t of ZONE_T) {
      const edgePoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // Stay close to the physical cloth edge so the extension inherits the
      // exact boundary colors rather than an average from farther in-frame.
      const sample = { x: edgePoint.x + (center.x - edgePoint.x) * .025, y: edgePoint.y + (center.y - edgePoint.y) * .025 };
      const color = averagePatch(data, sampleCanvas.width, sampleCanvas.height, sample.x * sampleCanvas.width, sample.y * sampleCanvas.height);
      if (!color) return null;
      zones.push({ edge, t, ...color });
    }
  }
  const lit = zones.filter(zone => zone.luma > 7);
  if (lit.length < 8 || lit.reduce((sum, zone) => sum + zone.luma, 0) / lit.length < 12) return null;
  return zones.map(zone => ({ edge: zone.edge, t: zone.t, color: enhancedHex(zone.red, zone.green, zone.blue) }));
}

function publishStatus(status, error = '') {
  const signature = `${status}:${error}`;
  if (signature === publishedStatus) return;
  publishedStatus = signature;
  window.lumenHalo.publishStatus({ status, error });
}

function stopCapture() {
  captureGeneration++;
  if (captureVideo) {
    captureVideo.pause();
    captureVideo.srcObject = null;
  }
  if (captureStream) for (const track of captureStream.getTracks()) track.stop();
  captureStream = null;
  captureVideo = null;
  captureSourceId = '';
  liveZones = [];
  blackFrames = 0;
  lastSampleAt = 0;
  publishedStatus = '';
}

function sampleContinuousFrame(now, generation) {
  if (generation !== captureGeneration || !captureVideo) return;
  // Realtime edge sampling with fast attack and a slower release follows scene
  // cuts immediately without flickering when one dark frame passes through.
  if (now - lastSampleAt >= 32) {
    lastSampleAt = now;
    const next = sampleVideoZones();
    if (!next) {
      if (++blackFrames >= 6) {
        liveZones = [];
        render({ ...current, zones: [] });
        publishStatus('fallback', 'Protected or black video cannot be sampled; using the app color.');
      }
    } else {
      blackFrames = 0;
      liveZones = next.map((zone, index) => {
        const previous = liveZones[index]?.color || zone.color;
        const previousRgb = rgb(previous), nextRgb = rgb(zone.color);
        const previousPeak = Math.max(...previousRgb), nextPeak = Math.max(...nextRgb);
        const distance = Math.max(...nextRgb.map((value, channel) => Math.abs(value - previousRgb[channel])));
        const response = distance > 72 ? .92 : nextPeak >= previousPeak ? .84 : .52;
        return { ...zone, color: mixHex(previous, zone.color, response) };
      });
      render({ ...current, zones: liveZones, dynamic: 'live' });
      publishStatus('live');
    }
  }
  if (captureVideo.requestVideoFrameCallback) captureVideo.requestVideoFrameCallback(time => sampleContinuousFrame(time, generation));
  else setTimeout(() => sampleContinuousFrame(performance.now(), generation), 32);
}

async function startCapture(sourceId, sourceError = '') {
  if (sourceError) {
    if (captureStream) stopCapture();
    publishStatus('fallback', sourceError);
    return;
  }
  if (!sourceId || (sourceId === captureSourceId && captureStream)) return;
  stopCapture();
  captureSourceId = sourceId;
  const generation = ++captureGeneration;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 320, maxHeight: 180, maxFrameRate: 30 } }
    });
    if (generation !== captureGeneration) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    captureStream = stream;
    captureVideo = document.createElement('video');
    captureVideo.muted = true;
    captureVideo.playsInline = true;
    captureVideo.srcObject = stream;
    await captureVideo.play();
    if (generation === captureGeneration) sampleContinuousFrame(performance.now(), generation);
  } catch (error) {
    if (generation !== captureGeneration) return;
    publishStatus('fallback', `Continuous projector capture failed: ${String(error?.message || error)}`);
  }
}

function size() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(innerWidth * dpr));
  const h = Math.max(1, Math.round(innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: innerWidth, h: innerHeight };
}

function polygon(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function distanceToRaster(point, normal, w, h) {
  const distances = [];
  if (normal.x > .0001) distances.push((w - point.x) / normal.x);
  if (normal.x < -.0001) distances.push(-point.x / normal.x);
  if (normal.y > .0001) distances.push((h - point.y) / normal.y);
  if (normal.y < -.0001) distances.push(-point.y / normal.y);
  return Math.max(1, Math.min(...distances.filter(value => value > 0)));
}

function zonesByEdge(zones, fallback) {
  return Array.from({ length: 4 }, (_, edge) => {
    const found = zones.filter(zone => zone.edge === edge).sort((a, b) => a.t - b.t);
    return found.length >= 3 ? found : ZONE_T.map(t => ({ edge, t, color: fallback }));
  });
}

function drawCapturedExtension(intensity, w, h) {
  if (!captureVideo || captureVideo.readyState < 2 || liveZones.length !== ZONE_T.length * 4) return false;
  const tw = textureCanvas.width, th = textureCanvas.height;
  textureContext.setTransform(1, 0, 0, 1, 0, 0);
  textureContext.globalCompositeOperation = 'source-over';
  textureContext.globalAlpha = 1;
  textureContext.filter = 'none';
  textureContext.clearRect(0, 0, tw, th);
  const passes = [
    // At 480×270 these blur radii scale to roughly 190, 80 and 24 pixels on Y9.
    { blur:48, saturation:1.85, brightness:2.05, alpha:.24 + intensity * .34 },
    { blur:20, saturation:1.7, brightness:1.7, alpha:.30 + intensity * .42 },
    { blur:6, saturation:1.45, brightness:1.35, alpha:.42 + intensity * .46 }
  ];
  passes.forEach((pass, index) => {
    textureContext.globalCompositeOperation = index ? 'screen' : 'source-over';
    textureContext.globalAlpha = Math.min(1, pass.alpha);
    textureContext.filter = `blur(${pass.blur}px) saturate(${pass.saturation}) brightness(${pass.brightness})`;
    textureContext.drawImage(captureVideo, 0, 0, tw, th);
  });
  textureContext.globalAlpha = 1;
  textureContext.filter = 'none';
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(textureCanvas, 0, 0, w, h);
  ctx.restore();
  return true;
}

function drawSoftEdge(points, edge, grouped, intensity, w, h, support = 1) {
  const a = points[edge], b = points[(edge + 1) % 4];
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // Points are clockwise, so the right-hand normal always faces the overspill.
  const normal = { x: dy / length, y: -dx / length };
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const margin = distanceToRaster(middle, normal, w, h);
  const spread = Math.max(64, Math.min(400, margin * 1.18));
  const own = grouped[edge];
  const previous = grouped[(edge + 3) % 4];
  const next = grouped[(edge + 1) % 4];
  const gradientFor = alpha => {
    const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, rgba(mixHex(previous.at(-1).color, own[0].color), alpha * .78));
    for (const zone of own) gradient.addColorStop(zone.t, rgba(zone.color, alpha));
    gradient.addColorStop(1, rgba(mixHex(own.at(-1).color, next[0].color), alpha * .78));
    return gradient;
  };
  // A broad wall wash makes the effect prominent; the tighter core preserves
  // local edge color. The raster mask below feathers both passes to true black.
  const passes = [
    { alpha: Math.min(.82, (.12 + intensity * .62) * support), width: spread * .94, blur: spread * .54 },
    { alpha: Math.min(.96, (.18 + intensity * .90) * support), width: spread * .38, blur: spread * .20 }
  ];
  for (const pass of passes) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(28, pass.width);
    ctx.filter = `blur(${Math.max(14, pass.blur)}px)`;
    ctx.strokeStyle = gradientFor(pass.alpha);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

function applyOuterFeather(points, w, h) {
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  const fades = {
    left: Math.max(18, Math.min(150, minX * .58)),
    right: Math.max(18, Math.min(150, (w - maxX) * .58)),
    top: Math.max(18, Math.min(120, minY * .58)),
    bottom: Math.max(18, Math.min(120, (h - maxY) * .58))
  };
  const masks = [
    [0, 0, fades.left, 0], [w, 0, w - fades.right, 0],
    [0, 0, 0, fades.top], [0, h, 0, h - fades.bottom]
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  for (const [x0, y0, x1, y1] of masks) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function render(state) {
  current = state;
  const { w, h } = size();
  const points = state.points?.length === 4 ? state.points : [
    { x: w * .08, y: h * .08 }, { x: w * .92, y: h * .08 },
    { x: w * .92, y: h * .92 }, { x: w * .08, y: h * .92 }
  ];
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);

  if (state.enabled) {
    const requested = Math.max(.04, Math.min(1, state.intensity || .35));
    // A perceptual floor makes low settings useful on a projection wall while
    // the slider still controls the full output range.
    const intensity = .22 + requested * .78;
    const zones = state.zones?.length >= 12 ? state.zones : Array.from({ length: ZONE_T.length * 4 }, (_, index) => ({
      edge: Math.floor(index / ZONE_T.length), t: ZONE_T[index % ZONE_T.length], color: state.color || '#8b7cff'
    }));
    const grouped = zonesByEdge(zones, state.color || '#8b7cff');
    const textured = drawCapturedExtension(intensity, w, h);
    // The sampled bands reinforce the far wash and provide a protected-video
    // fallback. When real pixels are available they stay subordinate to the
    // captured edge extension rather than recoloring it.
    for (let edge = 0; edge < 4; edge++) drawSoftEdge(points, edge, grouped, intensity, w, h, textured ? .32 : 1);

    // The projector raster itself must disappear softly into the wall instead of
    // ending as a colored rectangle. All four masks reach true transparency.
    applyOuterFeather(points, w, h);

    // Keep the movie completely untouched. The physical cloth edge hides this
    // cut while the light outside it falls away smoothly.
    ctx.globalCompositeOperation = 'destination-out';
    polygon(points);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  if (state.guide) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.9)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 10]);
    polygon(points);
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach((point, index) => {
      const active = index === state.selected;
      const arm = active ? 46 : 32;
      const gap = active ? 7 : 5;
      const drawCrosshair = (color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(point.x - arm, point.y); ctx.lineTo(point.x - gap, point.y);
        ctx.moveTo(point.x + gap, point.y); ctx.lineTo(point.x + arm, point.y);
        ctx.moveTo(point.x, point.y - arm); ctx.lineTo(point.x, point.y - gap);
        ctx.moveTo(point.x, point.y + gap); ctx.lineTo(point.x, point.y + arm);
        ctx.stroke();
      };
      drawCrosshair('rgba(0,0,0,.95)', active ? 7 : 6);
      drawCrosshair(active ? '#fff' : 'rgba(190,232,255,.9)', active ? 2.5 : 1.7);
      ctx.strokeStyle = active ? '#59e5ff' : 'rgba(255,255,255,.7)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(point.x - 2, point.y - 2, 4, 4);
    });
    const top = (points[0].y + points[1].y) / 2;
    ctx.fillStyle = '#fff';
    ctx.font = '600 22px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Align the active crosshair with corner ${(state.selected ?? 0) + 1}`, (points[0].x + points[1].x) / 2, Math.max(34, top - 42));
    ctx.restore();
  }
}

window.lumenHalo.onState(state => {
  current = { ...state, zones: liveZones.length ? liveZones : state.zones };
  render(current);
  if (!state.enabled) stopCapture();
  else startCapture(state.captureSourceId, state.captureError);
});
window.lumenHalo.onStop(stopCapture);
window.addEventListener('resize', () => render(current));
