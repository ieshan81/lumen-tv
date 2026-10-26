'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const SLEEP_STEPS = [0, 15, 30, 45, 60, 90];
  const ICONS = {
    phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    power: '<svg viewBox="0 0 24 24"><path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  let S = null; // latest state from the main process
  let rows = []; // [{ el, track, shift, items: [{ key, el, hero, act }] }]
  let focus = { r: 0, c: 0 };
  let focusKey = '';
  let lastHeroKey = '';
  let overlayOpen = false;
  let sleepChoice = 0;
  let modelSignature = '';

  // ---------------------------------------------------------------- sound
  let audioCtx = null;
  function blip(freq, ms = 40, gain = 0.035) {
    try {
      audioCtx = audioCtx || new AudioContext();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + ms / 1000);
    } catch { /* sound is optional */ }
  }

  // ---------------------------------------------------------------- model
  function letter(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function sleepLabel() {
    if (!S.sleepAt) return 'Off. Enter to set';
    const end = new Date(S.sleepAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const mins = Math.max(1, Math.round((S.sleepAt - Date.now()) / 60000));
    return `Ends in ${mins} min (${end})`;
  }

  function buildModel() {
    const model = [];
    if (S.running) {
      const r = S.running;
      model.push({
        label: 'Now playing',
        items: [
          {
            key: 'resume', cls: 'wide', name: r.name, sub: r.title || 'Paused', badge: 'Paused - Enter to resume',
            accent: r.accent, icon: r.icon, mono: letter(r.name),
            hero: { eyebrow: 'Paused', title: r.name, desc: r.title || 'Pick up where you left off.' },
            act: () => lumen.action('resume')
          },
          {
            key: 'closeapp', cls: 'small', name: 'Close app', svg: ICONS.close,
            hero: { eyebrow: 'System', title: 'Close ' + r.name, desc: 'Stop it completely and free up the browser.' },
            act: () => lumen.action('closeapp')
          }
        ]
      });
    }
    model.push({
      label: 'Apps',
      items: S.tiles.map((t) => ({
        key: 'tile:' + t.id, name: t.name, accent: t.accent, icon: t.icon, mono: letter(t.name),
        busy: S.launching === t.id,
        hero: { eyebrow: 'App', title: t.name, desc: t.desc || 'Press Enter to open.' },
        act: () => lumen.launch(t.id)
      }))
    });
    model.push({
      label: 'System',
      items: [
        {
          key: 'remote', cls: 'small', name: 'Phone remote', sub: S.remote.clients ? 'Connected' : 'Scan to connect', svg: ICONS.phone,
          hero: { eyebrow: 'System', title: 'Phone remote', desc: 'Turn your phone into a touchpad, keyboard and volume control.' },
          act: openOverlay
        },
        {
          key: 'sleep', cls: 'small', name: 'Sleep timer', sub: sleepLabel(), svg: ICONS.moon,
          hero: { eyebrow: 'System', title: 'Sleep timer', desc: 'Pause, close everything and let the projector rest after a set time. Press Enter to cycle: 15, 30, 45, 60, 90 minutes, off.' },
          act: cycleSleep
        },
        {
          key: 'exit', cls: 'small', name: 'Exit TV mode', svg: ICONS.power,
          hero: { eyebrow: 'System', title: 'Exit TV mode', desc: 'Go back to your normal desktop. Sound goes back to where it was.' },
          act: () => lumen.action('exit')
        }
      ]
    });
    return model;
  }

  // ---------------------------------------------------------------- rendering
  function tileEl(item) {
    const el = document.createElement('div');
    el.className = 'tile ' + (item.cls || '') + (item.sub ? ' has-sub' : '') + (item.busy ? ' busy' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', item.name);
    el.tabIndex = -1;
    el.addEventListener('click', () => { if (!item.busy) item.act(); });
    el.style.setProperty('--accent', item.accent || '#7c8cff');
    const art = document.createElement('div');
    art.className = 'art';
    const mono = () => {
      art.innerHTML = '';
      const m = document.createElement('span');
      m.className = 'mono';
      m.textContent = item.mono || '?';
      art.appendChild(m);
    };
    if (item.svg) {
      art.innerHTML = item.svg;
    } else if (item.icon) {
      const img = new Image();
      img.alt = '';
      img.src = item.icon;
      img.addEventListener('error', mono);
      art.appendChild(img);
    } else {
      mono();
    }
    el.appendChild(art);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    el.appendChild(name);
    if (item.sub) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = item.sub;
      el.appendChild(sub);
    }
    if (item.badge) {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = item.badge;
      el.appendChild(badge);
    }
    return el;
  }

  function render() {
    const model = buildModel();
    const holder = $('rows');
    holder.textContent = '';
    rows = model.map((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      const label = document.createElement('div');
      label.className = 'row-label';
      label.textContent = row.label;
      const track = document.createElement('div');
      track.className = 'track';
      track.style.position = 'relative';
      const items = row.items.map((item) => {
        const el = tileEl(item);
        track.appendChild(el);
        return { ...item, el };
      });
      rowEl.append(label, track);
      holder.appendChild(rowEl);
      return { el: rowEl, track, shift: 0, items };
    });

    // keep the cursor on the same tile when the state changes underneath it
    let found = null;
    rows.forEach((row, r) => row.items.forEach((it, c) => { if (it.key === focusKey) found = { r, c }; }));
    if (found) {
      focus = found;
    } else {
      // returning from an app puts you on "Resume"; otherwise start on the first app
      const firstApps = rows.findIndex((row) => row.items[0] && row.items[0].key.startsWith('tile:'));
      focus = { r: rows[0] && rows[0].items[0].key === 'resume' ? 0 : Math.max(0, firstApps), c: 0 };
    }
    focus.r = Math.min(focus.r, rows.length - 1);
    focus.c = Math.min(focus.c, rows[focus.r].items.length - 1);
    applyFocus(false);
  }

  function current() {
    return rows[focus.r] && rows[focus.r].items[focus.c];
  }

  function applyFocus(sound) {
    const item = current();
    if (!item) return;
    focusKey = item.key;
    for (const row of rows) for (const it of row.items) it.el.classList.toggle('focused', it === item);

    document.body.style.setProperty('--accent', item.accent || '#7c6cff');

    if (lastHeroKey !== item.key) {
      lastHeroKey = item.key;
      $('hero-eyebrow').textContent = item.hero.eyebrow;
      $('hero-title').textContent = item.hero.title;
      $('hero-desc').textContent = item.hero.desc;
      $('hero-letter').textContent = item.mono || '';
      const copy = $('hero-copy');
      copy.classList.remove('swap');
      void copy.offsetWidth;
      copy.classList.add('swap');
    }

    // vertical: bring the focused row to the top of the viewport and fade out the rows above it
    rows.forEach((r, i) => r.el.classList.toggle('above', i < focus.r));
    const first = rows[0].el.offsetTop;
    $('rows').style.transform = `translateY(${-(rows[focus.r].el.offsetTop - first)}px)`;

    // horizontal: keep the focused tile inside the safe margin
    const row = rows[focus.r];
    const margin = parseFloat(getComputedStyle(document.documentElement).fontSize) * 4.6;
    let shift = row.shift;
    const right = item.el.offsetLeft + item.el.offsetWidth - shift;
    if (right > innerWidth - margin) shift += right - (innerWidth - margin);
    if (item.el.offsetLeft - shift < margin) shift -= margin - (item.el.offsetLeft - shift);
    row.shift = Math.max(0, shift);
    row.track.style.transform = `translateX(${-row.shift}px)`;

    if (sound) blip(920, 28);
  }

  function move(dr, dc) {
    if (dc) {
      const n = rows[focus.r].items.length;
      const c = Math.min(n - 1, Math.max(0, focus.c + dc));
      if (c === focus.c) return;
      focus.c = c;
    } else {
      const r = Math.min(rows.length - 1, Math.max(0, focus.r + dr));
      if (r === focus.r) return;
      focus.r = r;
      focus.c = Math.min(focus.c, rows[r].items.length - 1);
    }
    applyFocus(true);
  }

  // ---------------------------------------------------------------- overlay & actions
  function openOverlay() {
    if (!S) return;
    $('qr').innerHTML = S.remote.qr || '';
    $('url').textContent = S.remote.urls[0] || '';
    $('stable').textContent = S.remote.stable || '';
    $('stable-row').hidden = !S.remote.stable;
    $('blocked').hidden = !S.remote.blocked;
    $('overlay').hidden = false;
    overlayOpen = true;
  }

  function closeOverlay() {
    $('overlay').hidden = true;
    overlayOpen = false;
  }

  function cycleSleep() {
    const idx = SLEEP_STEPS.indexOf(sleepChoice);
    sleepChoice = SLEEP_STEPS[(idx + 1) % SLEEP_STEPS.length];
    lumen.action('sleep', sleepChoice);
    blip(660, 60);
  }

  function activate() {
    const item = current();
    if (!item || item.busy) return;
    blip(1180, 60, 0.045);
    item.act();
  }

  function handleKey(k) {
    if (!S || S.launching) return;
    if (overlayOpen) {
      if (['Esc', 'Back', 'Enter', 'Space'].includes(k)) closeOverlay();
      return;
    }
    switch (k) {
      case 'Left': return move(0, -1);
      case 'Right': return move(0, 1);
      case 'Up': return move(-1, 0);
      case 'Down': return move(1, 0);
      case 'Enter':
      case 'Space': return activate();
      case 'Esc':
      case 'Back':
      case 'Backspace':
        if (S.running) lumen.action('resume');
        return undefined;
      default: return undefined;
    }
  }

  const KEYMAP = {
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    Enter: 'Enter', ' ': 'Space', Escape: 'Esc', Backspace: 'Back'
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault();
    handleKey(k);
  });

  // ---------------------------------------------------------------- chrome (clock, hints, toast)
  function tick() {
    if (document.hidden) return;
    const now = new Date();
    $('time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    if (S && S.sleepAt && !overlayOpen) {
      const sleepItem = rows.flatMap((r) => r.items).find((i) => i.key === 'sleep');
      if (sleepItem) sleepItem.el.querySelector('.sub').textContent = sleepLabel();
    }
  }

  function renderChrome() {
    const live = S.remote.clients > 0;
    $('chip').classList.toggle('live', live);
    $('chip-text').textContent = live ? 'Phone remote connected' : 'Phone not connected. Pair it under System, Phone remote';
    const hot = (S.hotkeys && S.hotkeys[0]) || 'Ctrl+Shift+H';
    $('hints').innerHTML =
      '<span><kbd>&larr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd> Move</span>' +
      '<span><kbd>Enter</kbd> Open</span>' +
      '<span><kbd>Esc</kbd> ' + (S.running ? 'Back to ' + S.running.name : 'Back') + '</span>' +
      '<span style="margin-left:auto"><kbd>' + hot + '</kbd> Home, from anywhere</span>';
  }

  // the phone's d-pad / OK / Back arrive here, whichever window has focus
  lumen.onNav(handleKey);

  let toastTimer;
  lumen.onToast((text) => {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4500);
  });

  lumen.onState((s) => {
    const prev = S;
    S = s;
    if (!S.sleepAt) sleepChoice = 0;
    // coming back from an app: land on "Resume" so one press picks up where you were
    if (S.mode === 'home' && S.running && (!prev || prev.mode !== 'home')) focusKey = 'resume';
    renderChrome();
    const signature = JSON.stringify({ mode:S.mode, tiles:S.tiles, running:S.running, launching:S.launching, sleepAt:S.sleepAt });
    if (signature !== modelSignature) { modelSignature = signature; render(); }
    if (overlayOpen) {
      $('qr').innerHTML = S.remote.qr || '';
      $('blocked').hidden = !S.remote.blocked;
      // the phone just connected: the QR has done its job
      if (S.remote.clients > 0) closeOverlay();
    }
  });

  tick();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('launcher-hidden', document.hidden);
    if (!document.hidden) tick();
  });
  setInterval(tick, 15000);
  lumen.ready();
})();
