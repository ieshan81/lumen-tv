'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  let ws = null;
  let state = null;
  let retry = 0;
  let reconnectTimer = null;
  let manualPad = localStorage.getItem('lumen-pad') || '';
  let appsSignature = '';
  let focusedFieldId = '';
  let dismissedFieldId = '';
  let liveEditTimer = null;
  let displaySignature = '';
  let audioSignature = '';
  let phoneStorage;
  try { phoneStorage = localStorage; } catch { /* restricted/private browser */ }
  const haptics = window.createLumenHaptics({ navigator, storage:phoneStorage, visible:() => document.visibilityState === 'visible' });

  function connected() { return ws && ws.readyState === WebSocket.OPEN; }
  function send(msg) {
    if (!connected()) {
      toast('Lumen is reconnecting to the laptop…');
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }

  function setConnection(live, label) {
    $('dot').classList.toggle('live', live);
    $('connectionText').textContent = label;
    $('connection').classList.toggle('live', live);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(`${proto}://${location.host}/ws${location.search}`); } catch { scheduleReconnect(); return; }
    const socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      retry = 0;
      setConnection(true, 'Connected');
      renderStatus();
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      setConnection(false, navigator.onLine ? 'Reconnecting' : 'Offline');
      $('status').textContent = navigator.onLine ? 'Reconnecting to the laptop…' : 'This phone is offline';
      scheduleReconnect();
    };
    ws.onerror = () => socket.close();
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.t === 'state') { state = msg; renderState(); }
      else if (msg.t === 'toast') toast(msg.text);
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, Math.min(8000, 700 + retry++ * 650));
  }

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function renderHaptics() {
    $('hapticsEnabled').checked = haptics.enabled;
    $('hapticsEnabled').disabled = !haptics.supported;
    $('testHaptics').disabled = !haptics.supported || !haptics.enabled;
    $('hapticsNote').textContent = !haptics.supported
      ? 'This browser does not expose vibration (including iPhone Safari). Remote controls still work with visual feedback.'
      : haptics.enabled ? 'Light navigation ticks and firmer playback taps. Your phone settings can still suppress vibration.' : 'Haptic feedback is off on this phone.';
  }
  function buttonHaptic(button) {
    if (!button || button.disabled || button.dataset.haptic === 'none') return;
    const kind = button.dataset.action === 'enter' ? 'primary'
      : button.dataset.key === 'Enter' || button.dataset.media === 'playpause' || ['home','homeButton'].includes(button.id) ? 'impact' : 'selection';
    haptics.trigger(kind);
  }
  document.addEventListener('pointerdown', event => buttonHaptic(event.target.closest('button')), { passive:true });
  document.addEventListener('click', event => { if (event.detail === 0) buttonHaptic(event.target.closest('button')); });
  $('hapticsEnabled').addEventListener('change', () => { haptics.setEnabled($('hapticsEnabled').checked); renderHaptics(); if (haptics.enabled) haptics.trigger('impact',true); });
  $('testHaptics').addEventListener('click', () => {
    const accepted = haptics.trigger('primary', true);
    toast(accepted ? 'Test pulse requested. If you felt nothing, check your phone settings.' : 'This browser could not request vibration.');
  });
  renderHaptics();
  function formatTime(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }

  function renderStatus() {
    if (!state) return;
    if (state.preview) { $('status').textContent = 'Design preview · simulated TV'; return; }
    if (state.starting) $('status').textContent = state.startMessage || 'Starting TV mode…';
    else if (state.mode === 'off') $('status').textContent = state.projector && state.projector.connected ? 'Projector ready · TV mode off' : 'Waiting for your projector';
    else if (state.mode === 'home') $('status').textContent = 'TV home is on the projector';
    else $('status').textContent = state.running ? `Watching ${state.running.name}` : 'TV mode is active';
  }

  function renderPower() {
    const off = state.mode === 'off';
    const projector = state.projector || {};
    $('powerCard').hidden = !off;
    $('nowCard').hidden = off;
    $('remoteControls').hidden = off;
    $('projectorName').textContent = projector.label || `${projector.match || 'Y9'} projector`;
    $('projectorState').textContent = projector.connected ? 'HDMI display detected by Windows' : 'Not detected yet — power it on and select HDMI';
    $('projectorDot').classList.toggle('ready', !!projector.connected);

    const start = $('startButton');
    start.disabled = !!state.starting || !connected();
    start.classList.toggle('loading', !!state.starting);
    $('startLabel').textContent = state.starting ? 'Starting Lumen…' : 'Start Lumen';
    $('startSub').textContent = state.starting ? (state.startMessage || 'Preparing the projector') : 'Open the TV home and switch audio';
    $('powerHint').textContent = state.starting ? 'Keep the projector on HDMI while Windows finishes connecting.' : 'Turn on the projector, select HDMI, then start Lumen.';
    $('startError').hidden = !state.error;
    $('startError').textContent = state.error || '';
    $$('[data-action="enter"]').forEach((button) => { button.disabled = !!state.starting || !connected() || !off; });
    $('exit').hidden = off;
    $('enterMore').hidden = !off;
  }

  function renderNowPlaying() {
    if (state.mode === 'off') return;
    const media = state.media;
    const running = state.running;
    const title = (media && (media.title || media.series)) || (running && (running.title || running.name)) || 'TV Home';
    const app = (running && running.name) || 'Lumen TV';
    $('nowTitle').textContent = title;
    $('nowEyebrow').textContent = app.toUpperCase().slice(0, 24);
    $('nowLetter').textContent = app.charAt(0).toUpperCase() || 'L';
    $('nowLetter').hidden = !!(running && running.icon);
    $('nowArt').style.background = running && running.accent ? `radial-gradient(circle at 30% 20%, ${running.accent}, #242638)` : '';
    let art = $('nowArt').querySelector('img');
    if (running && running.icon) {
      if (!art) {
        art = document.createElement('img');
        art.alt = '';
        $('nowArt').appendChild(art);
      }
      art.src = running.icon;
    } else if (art) {
      art.remove();
    }

    if (media && media.duration > 0) {
      const detail = [];
      if (media.season != null) detail.push(`S${media.season}`);
      if (media.episode != null) detail.push(`E${media.episode}`);
      detail.push(`${formatTime(media.currentTime)} / ${formatTime(media.duration)}`);
      $('nowMeta').textContent = detail.join(' · ');
      $('progress').hidden = false;
      $('progressFill').style.width = `${Math.min(100, (media.currentTime / media.duration) * 100)}%`;
    } else {
      $('nowMeta').textContent = state.mode === 'home' ? 'Choose something to watch' : `Open in ${app}`;
      $('progress').hidden = true;
    }
    const actions = state.mode==='app' ? {...media?.actions,...state.controls} : {};
    const playing = media && media.playing;
    $('playPause').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('playPause').classList.toggle('is-playing', !!playing);
    $('playLabel').textContent = playing ? 'Pause' : 'Play';
    $('playIcon').innerHTML = playing ? '<path d="M7 5h4v14H7zM14 5h4v14h-4z"/>' : '<path d="M8 5.5 18 12 8 18.5z"/>';
    $('transport').hidden = state.mode === 'home';
    $$('[data-media="back10"],[data-media="fwd10"]').forEach(button => { button.disabled = !media || media.duration <= 0; });
    $('playbackQuality').hidden = !media;
    const quality = [];
    if (media && media.width && media.height) quality.push(`${media.width} × ${media.height}`);
    if (media && media.bufferedSeconds != null) quality.push(`${media.bufferedSeconds}s buffered`);
    if (media && media.totalFrames > 0 && media.droppedFrames / media.totalFrames > .02) quality.push('Some frames dropped');
    $('playbackQuality').textContent = quality.join(' · ') || 'Playback controls follow the active player';
    $('episodeRow').hidden = !actions.previousEpisode && !actions.nextEpisode;
    $('episodeRow').style.gridTemplateColumns=actions.previousEpisode&&actions.nextEpisode?'repeat(2,minmax(0,1fr))':'1fr';
    $$('[data-site]').forEach(button=>{button.hidden=!actions[button.dataset.site];});
    $('playerTools').hidden=!$$('#playerTools button').some(button=>!button.hidden);

    const audio = state.audio || {};
    $('audioState').classList.toggle('error', audio.status === 'error');
    $('audioState').textContent = audio.status === 'switching' ? 'Switching audio output…'
      : audio.status === 'ready' ? `Sound: ${audio.name || 'projector'}`
        : audio.status === 'error' ? 'Audio output unavailable. Open More → Audio & volume.' : '';
    $('volumeReadout').hidden=!state.volume;
    $('volumeReadout').textContent=state.volume ? state.volume.muted ? `Muted · level ${state.volume.percent}%` : `Volume ${state.volume.percent}%` : '';
    document.querySelector('[data-media="mute"]').setAttribute('aria-pressed',String(!!state.volume?.muted));
  }

  function renderApps() {
    const signature = JSON.stringify({ tiles:state.tiles, running:state.running?.tileId });
    if (signature === appsSignature) return;
    appsSignature = signature;
    const apps = $('apps');
    apps.textContent = '';
    for (const tile of state.tiles || []) {
      const button = document.createElement('button');
      button.className = 'app';
      button.style.setProperty('--c', tile.accent || '#8b7cff');
      if (tile.icon) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = tile.icon;
        button.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = tile.name;
      button.appendChild(label);
      button.addEventListener('click', () => { send({ t: 'launch', id: tile.id }); showTab('control'); });
      apps.appendChild(button);
    }
    const running = state.running;
    $('resume').hidden = !running;
    $('closeapp').hidden = !running;
    if (running) $('resume').textContent = `Resume ${running.name}`;
  }

  function renderAddress() {
    const stable = state && state.stableUrl;
    if (!stable) return;
    let host = '';
    try { host = new URL(stable).host; } catch { return; }
    const onStable = location.host === host;
    $('stable').hidden = onStable;
    $('stable').onclick = () => { location.href = stable; };
    $('addrnote').textContent = onStable ? 'This Home Screen shortcut uses the laptop’s permanent local name.' : 'Switch to the permanent address before adding Lumen to your Home Screen.';
  }

  function renderSleep() {
    const left = state.sleepAt ? Math.max(1, Math.round((state.sleepAt - Date.now()) / 60000)) : 0;
    $('sleepnote').textContent = left ? `Lumen will stop in about ${left} minutes.` : 'No sleep timer is running.';
    $$('#sleep button').forEach((button) => button.classList.toggle('on', (!left && button.dataset.min === '0') || Number(button.dataset.min) === left));
  }

  function renderState() {
    renderStatus();
    renderPower();
    renderNowPlaying();
    renderApps();
    renderAddress();
    renderSleep();
    renderDisplayRecognition();
    renderAudioSettings();
    renderKeyboard();
    setPad(manualPad || (state.mode === 'home' ? 'dpad' : state.navigation || 'touch'), false);
    renderControlHint();
    $('contextLabel').textContent = state.input ? 'TYPE ON YOUR TV' : state.media ? 'NOW PLAYING' : 'BROWSE YOUR TV';
    $('account').disabled = !state.running;
    document.body.dataset.mode = state.media ? 'playing' : state.mode;
  }
  function renderAudioSettings(){
    const devices=state.audioDevices||[];
    const signature=JSON.stringify(devices);
    if(signature!==audioSignature){
      audioSignature=signature;$('audioOutput').textContent='';
      for(const device of devices){const option=document.createElement('option');option.value=device.id;option.textContent=device.name+(device.isDefault?' · Active':'');option.selected=device.isDefault;$('audioOutput').appendChild(option);}
      if(!devices.length){const option=document.createElement('option');option.textContent='No audio outputs available';$('audioOutput').appendChild(option);}
    }
    const switching=state.audio?.status==='switching';
    $('audioOutput').disabled=state.mode==='off'||switching||!devices.length;
    $('refreshAudio').disabled=!!state.audioDevicesLoading;
    $('audioOutputNote').textContent=state.audioDevicesError||state.audio?.error||(switching?'Switching audio output…':state.audioDevicesLoading?'Refreshing devices…':state.mode==='off'?'Start Lumen to change the audio output.':'Changes the Windows output now and remembers it for next time.');
    $('volumeAutoHide').checked=state.volumeAutoHide!==false;
    $('hideVolume').disabled=!state.volumeOverlayVisible;
  }
  $('audioOutput').addEventListener('change',()=>send({t:'audio',action:'select',id:$('audioOutput').value}));
  $('refreshAudio').addEventListener('click',()=>send({t:'audio',action:'refresh'}));
  $('volumeAutoHide').addEventListener('change',()=>send({t:'volume-preferences',autoHide:$('volumeAutoHide').checked}));
  function renderDisplayRecognition(){
    const projector=state.projector||{};
    $('displayRecognition').textContent=projector.reason|| (projector.connected?'Projector detected':'Connect the projector and select HDMI.');
    const options=projector.options||[];
    const signature=JSON.stringify(options);
    if(signature!==displaySignature){
      displaySignature=signature;$('projectorSelect').textContent='';
      for(const display of options){const option=document.createElement('option');option.value=String(display.id);option.textContent=`${display.label} · ${display.width} × ${display.height}`;option.selected=display.selected;$('projectorSelect').appendChild(option);}
      if(!options.length){const option=document.createElement('option');option.textContent='No external screens detected';$('projectorSelect').appendChild(option);}
    }
    $('projectorSelect').disabled=!options.length;
    $('rememberProjector').disabled=!options.length;
    document.querySelector('[data-media="showvolume"]').disabled=state.mode==='off';
  }
  $('rememberProjector').addEventListener('click',()=>{
    const id=Number($('projectorSelect').value);
    const chosen=state.projector?.options?.find(display=>display.id===id);
    if(!chosen)return;
    if(state.mode!=='off'&&!chosen.selected&&!confirm('Switch Lumen to this display? This closes the current app.'))return;
    send({t:'projector',id});
  });

  function renderKeyboard() {
    const input = state.mode === 'app' ? state.input : null;
    const nextId = input?.fieldId || '';
    if (focusedFieldId !== nextId) {
      clearTimeout(liveEditTimer);
      focusedFieldId = nextId;
      $('liveText').value = '';
      if (!nextId) { $('liveText').blur(); dismissedFieldId = ''; }
      else {
        const box = $('liveText');
        box.type = ['password','email','url','tel','search','number'].includes(input.type) ? input.type : 'text';
        box.inputMode = input.type === 'number' ? 'numeric' : input.type === 'email' ? 'email' : input.type === 'tel' ? 'tel' : 'text';
        box.autocomplete = 'off';
        $('fieldLabel').textContent = input.label || 'Type on your TV';
        $('keyboardHint').textContent = input.type === 'password' ? 'Your password is sent only to the selected TV field; Lumen does not save it.' : 'Type here to replace the selected TV field. Changes appear as you type.';
        if (document.visibilityState === 'visible') showTab('control');
      }
      $('keyboardContext').hidden = !nextId;
      if (nextId && document.visibilityState === 'visible') $('liveText').focus({ preventScroll:true });
    }
    $('keyboardContext').hidden = !nextId || dismissedFieldId === nextId;
  }

  function flushLiveEdit() {
    clearTimeout(liveEditTimer);
    if (focusedFieldId && state?.input?.fieldId === focusedFieldId) send({ t:'edit', fieldId:focusedFieldId, s:$('liveText').value });
  }
  $('liveText').addEventListener('input', event => {
    if (event.isComposing) return;
    clearTimeout(liveEditTimer);
    liveEditTimer = setTimeout(flushLiveEdit, 100);
  });
  $('liveText').addEventListener('compositionend', flushLiveEdit);
  $('liveForm').addEventListener('submit', event => { event.preventDefault(); flushLiveEdit(); send({t:'key',k:'Enter'}); $('liveText').blur(); });
  $('dismissKeyboard').addEventListener('click', () => { dismissedFieldId = focusedFieldId; $('keyboardContext').hidden = true; $('liveText').blur(); });

  function showTab(name) {
    $$('nav button').forEach((button) => button.classList.toggle('on', button.dataset.tab === name));
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.id === `tab-${name}`));
    const main = document.querySelector('main');
    main.scrollTop = 0;
    if(name==='more')send({t:'audio',action:'refresh'});
  }
  $$('nav button').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));

  function setPad(which, manual) {
    if (manual) {
      manualPad = which === 'auto' ? '' : which;
      if (manualPad) localStorage.setItem('lumen-pad', manualPad);
      else localStorage.removeItem('lumen-pad');
    }
    if (which === 'auto') which = state?.mode === 'home' ? 'dpad' : state?.navigation || 'touch';
    $('dpad').hidden = which !== 'dpad';
    $('touchpad').hidden = which !== 'touch';
    $$('#padseg button').forEach((button) => {
      const selected = button.dataset.pad === (manualPad || 'auto');
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    renderControlHint();
  }
  function renderControlHint() {
    const label = state?.mode === 'app' && state.focus?.label;
    $('controlHint').textContent = $('dpad').hidden ? 'Drag to point · tap to click' : label ? `OK · ${label}` : 'Arrows to move · OK to open';
    $('controlHint').title = label || '';
  }
  $$('#padseg button').forEach((button) => button.addEventListener('click', () => setPad(button.dataset.pad, true)));

  function bind(element, fn, repeatable) {
    let timer = null;
    let interval = null;
    const stop = () => { clearTimeout(timer); clearInterval(interval); };
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (document.activeElement === $('liveText')) $('liveText').blur();
      fn();
      if (repeatable) timer = setTimeout(() => { interval = setInterval(() => { haptics.trigger('selection'); fn(); }, 105); }, 360);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((name) => element.addEventListener(name, stop));
    element.addEventListener('click', event => { if (event.detail === 0) fn(); });
  }
  $$('[data-key]').forEach((button) => bind(button, () => send({ t: 'key', k: button.dataset.key }), button.dataset.repeat !== '0' && ['Up', 'Down', 'Left', 'Right', 'Backspace', 'Space'].includes(button.dataset.key)));
  $$('[data-media]').forEach((button) => bind(button, () => send({ t: 'media', a: button.dataset.media }), button.dataset.repeat === '1'));
  $$('[data-site]').forEach((button) => bind(button, () => send({ t: 'site', action: button.dataset.site }), false));
  [$('home'), $('homeButton')].forEach((button) => bind(button, () => send({ t: 'home' }), false));

  const pad = $('touchpad');
  let pending = { dx: 0, dy: 0, scroll: 0 };
  let frame = 0;
  function flush() {
    frame = 0;
    if (pending.dx || pending.dy) send({ t: 'move', dx: Math.round(pending.dx), dy: Math.round(pending.dy) });
    if (pending.scroll) send({ t: 'scroll', n: Math.round(pending.scroll * 100) / 100 });
    pending = { dx: 0, dy: 0, scroll: 0 };
  }
  function queue() { if (!frame) frame = requestAnimationFrame(flush); }
  const touches = new Map();
  let gesture = null;
  function accel(delta) { return delta * (1.08 + Math.min(Math.abs(delta), 30) * .068); }
  pad.addEventListener('pointerdown', (event) => {
    pad.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pad.classList.add('active');
    if (!gesture) gesture = { start: performance.now(), moved: 0, maxFingers: 0 };
    gesture.maxFingers = Math.max(gesture.maxFingers, touches.size);
  });
  pad.addEventListener('pointermove', (event) => {
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch.x = event.clientX; touch.y = event.clientY;
    gesture.moved += Math.abs(dx) + Math.abs(dy);
    if (touches.size >= 2) {
      if (event.pointerId === touches.keys().next().value) { pending.scroll += -dy / 26; queue(); }
    } else { pending.dx += accel(dx); pending.dy += accel(dy); queue(); }
  });
  function lift(event) {
    if (!touches.has(event.pointerId)) return;
    touches.delete(event.pointerId);
    if (!touches.size && gesture) {
      if (performance.now() - gesture.start < 280 && gesture.moved < 11 && event.type === 'pointerup') {
        send({ t: 'click', b: gesture.maxFingers >= 2 ? 'right' : 'left' });
        haptics.trigger('selection');
      }
      gesture = null;
      pad.classList.remove('active');
    }
  }
  pad.addEventListener('pointerup', lift);
  pad.addEventListener('pointercancel', lift);

  function typeIt(enter) {
    const box = $('text');
    if (!box.value) return;
    if (send({ t: 'text', s: box.value, enter })) {
      box.value = '';
      toast(enter ? 'Typed and pressed Enter' : 'Typed on the TV');
    }
  }
  $('send').addEventListener('click', () => typeIt(false));
  $('sendEnter').addEventListener('click', () => typeIt(true));
  $('text').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') typeIt(true); });
  $('resume').addEventListener('click', () => { send({ t: 'resume' }); showTab('control'); });
  $('account').addEventListener('click', () => send({t:'account'}));
  $('closeapp').addEventListener('click', () => { if (confirm('Close the current app?')) send({ t: 'closeapp' }); });
  $$('[data-action="enter"]').forEach((button) => button.addEventListener('click', () => { send({ t: 'enter' }); showTab('control'); }));
  $('exit').addEventListener('click', () => { if (confirm('Exit TV mode and restore laptop audio?')) send({ t: 'exit' }); });
  $$('#sleep button').forEach((button) => button.addEventListener('click', () => { send({ t: 'sleep', min: Number(button.dataset.min) }); }));

  let wakeLock = null;
  async function keepAwake() {
    if (wakeLock || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { connect(); keepAwake(); } else haptics.cancel(); });
  document.addEventListener('pointerdown', keepAwake, { once: true });
  window.addEventListener('online', connect);
  window.addEventListener('offline', () => setConnection(false, 'Offline'));
  function resizeViewport() { document.documentElement.style.setProperty('--visible-height', `${Math.round(window.visualViewport?.height || innerHeight)}px`); }
  window.visualViewport?.addEventListener('resize', resizeViewport);
  resizeViewport();
  setPad(manualPad || 'dpad', false);
  connect();
})();
