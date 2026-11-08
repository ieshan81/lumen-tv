'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  let ws = null;
  let state = null;
  let retry = 0;
  let reconnectTimer = null;
  let connectTimer = null;
  let pendingMessages = [];
  let phoneStorage;
  try { phoneStorage = localStorage; } catch { /* restricted/private browser */ }
  let manualPad = '';
  let padMode = 'dpad';
  try { manualPad = phoneStorage?.getItem('lumen-pad') || ''; } catch { /* storage can be denied */ }
  let appsSignature = '';
  let focusedFieldId = '';
  let dismissedFieldId = '';
  let liveEditTimer = null;
  let displaySignature = '';
  let audioSignature = '';
  let irSignature = '';
  let haloPreviewTimer = null;
  let haloSelectedPoint = 0;
  const haptics = window.createLumenHaptics({ navigator, storage:phoneStorage, visible:() => document.visibilityState === 'visible' });
  $('haloDot').closest('details')?.classList.add('halo-card');

  function connected() { return ws && ws.readyState === WebSocket.OPEN; }
  // When the laptop runs a newer remote than this page was loaded with, reload so the phone updates itself.
  function staleBuild(serverBuild) {
    const mine = document.querySelector('meta[name="lumen-build"]')?.content;
    if (!serverBuild || !mine || mine.startsWith('__') || serverBuild === mine) return false;
    try {
      if (Date.now() - Number(phoneStorage?.getItem('lumen-reloaded') || 0) < 15000) return false;
      phoneStorage?.setItem('lumen-reloaded', String(Date.now()));
    } catch { /* storage can be denied; reload once per page load below */ }
    location.reload();
    return true;
  }
  function queueMessage(msg) {
    const now = Date.now();
    pendingMessages = pendingMessages.filter(item => item.expires > now);
    if (msg.t === 'enter' || msg.t === 'home') pendingMessages = pendingMessages.filter(item => item.msg.t !== msg.t);
    pendingMessages.push({ msg, expires: now + 5000 });
    pendingMessages = pendingMessages.slice(-16);
  }
  function flushPending() {
    if (!connected()) return;
    const now = Date.now();
    const queued = pendingMessages.filter(item => item.expires > now);
    pendingMessages = [];
    for (const item of queued) ws.send(JSON.stringify(item.msg));
  }
  function send(msg) {
    if (!connected()) {
      queueMessage(msg);
      toast('Lumen is reconnecting to the laptop…');
      connect();
      return true;
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
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (socket !== ws || socket.readyState === WebSocket.OPEN) return;
      reconnect();
    }, 7000);
    ws.onopen = () => {
      if (socket !== ws) return;
      clearTimeout(connectTimer);
      retry = 0;
      setConnection(true, 'Connected');
      flushPending();
      renderStatus();
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      clearTimeout(connectTimer);
      setConnection(false, navigator.onLine ? 'Reconnecting' : 'Offline');
      $('status').textContent = navigator.onLine ? 'Reconnecting to the laptop…' : 'This phone is offline';
      scheduleReconnect();
    };
    ws.onerror = () => socket.close();
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.t === 'state') { if (staleBuild(msg.build)) return; state = msg; renderState(); }
      else if (msg.t === 'toast') toast(msg.text);
    };
  }

  // A phone can keep a dead socket marked OPEN after sleep, Wi-Fi roaming or back/forward cache.
  // Retire it before reconnecting so taps cannot silently go to the previous connection.
  function reconnect() {
    clearTimeout(reconnectTimer);
    clearTimeout(connectTimer);
    const previous = ws;
    ws = null;
    if (previous) previous.close();
    setConnection(false, navigator.onLine ? 'Reconnecting' : 'Offline');
    connect();
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

  function renderAssistant() {
    const assistant = state?.assistant || {};
    const voice = assistant.voice || {};
    const listening = assistant.status === 'listening' || voice.armed;
    $('assistantMic').classList.toggle('listening', listening || assistant.status === 'thinking');
    $('assistantMic').disabled = assistant.status === 'thinking' || !connected();
    $('assistantMessage').textContent = assistant.status === 'thinking' ? 'Thinking…'
      : listening ? 'Listening on the laptop. Say your request now.'
        : assistant.message || (voice.error ? `Voice unavailable: ${voice.error}. Typed requests still work.` : 'Tap the orb, then speak—or type a request.');
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
    $('projectorQuick').hidden=false;
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
    const target=state.volumeTarget||{kind:'windows',label:state.volume?.name||'Windows audio'};
    $('volumeTarget').textContent=target.kind==='projector'?`Volume controls projector speaker · ${target.label}`:`Volume controls Windows · ${target.label}`;
    $('volumeTarget').classList.toggle('projector',target.kind==='projector');
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
    renderAssistant();
    renderPower();
    renderNowPlaying();
    renderApps();
    renderAddress();
    renderSleep();
    renderDisplayRecognition();
    renderAudioSettings();
    renderIr();
    renderGalaxy();
    renderHalo();
    renderKeyboard();
    setPad(manualPad || (state.mode === 'home' ? 'dpad' : state.navigation || 'touch'), false);
    renderControlHint();
    $('contextLabel').textContent = padMode==='projector'?'PROJECTOR IR':state.input ? 'TYPE ON YOUR TV' : state.media ? 'NOW PLAYING' : 'BROWSE YOUR TV';
    $('account').disabled = !state.running;
    document.body.dataset.mode = state.media ? 'playing' : state.mode;
  }

  $('assistantMic').addEventListener('click', () => send({ t:'assistant', action:'arm' }));
  $('assistantForm').addEventListener('submit', event => {
    event.preventDefault();
    const text = $('assistantInput').value.trim();
    if (!text) return;
    if (send({ t:'assistant', action:'query', text })) $('assistantInput').value = '';
  });
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
  function renderIr(){
    const ir=state.ir||{status:'loading',remotes:[],buttons:[]};
    const ready=ir.status==='ready';
    $('irDot').classList.toggle('ready',ready);
    $('irStatus').textContent=ir.error||(ir.status==='loading'?'Connecting to the IR hub…':ready?`${ir.remoteName||'Projector remote'} is ready${ir.lastButton?` · ${ir.lastButton} sent`:''}`:'Choose the saved remote that controls the projector.');
    const signature=JSON.stringify({remotes:ir.remotes,buttons:ir.buttons,remoteName:ir.remoteName});
    if(signature!==irSignature){
      irSignature=signature;$('irRemote').textContent='';
      for(const remote of ir.remotes||[]){const option=document.createElement('option');option.value=remote.id;option.textContent=remote.name;option.selected=remote.selected;$('irRemote').appendChild(option);}
      if(!ir.remotes?.length){const option=document.createElement('option');option.textContent='No projector remote found';$('irRemote').appendChild(option);}
      $('irButtons').textContent='';
      for(const button of ir.buttons||[]){const item=document.createElement('button');item.type='button';item.className=`ir-button ir-${button.id}`;item.dataset.ir=button.id;item.textContent=button.label;item.addEventListener('click',()=>send({t:'ir',action:'press',button:button.id}));$('irButtons').appendChild(item);}
    }
    $('irRemote').disabled=ir.busy||!ir.remotes?.length;
    $('refreshIr').disabled=ir.busy||ir.status==='loading';
    $$('#irButtons button').forEach(button=>button.disabled=ir.busy||!ready);
    $$('[data-ir-main]').forEach(button=>{button.disabled=ir.busy||!ready||!ir.buttons?.some(item=>item.id===button.dataset.irMain);});
    $$('[data-galaxy]').forEach(button=>{button.disabled=ir.busy||!ready;});
    const galaxy=state.galaxy||{};
    const galaxyText=galaxy.enabled&&galaxy.night&&galaxy.status==='synced'?` · Galaxy ${galaxy.desired}`:'';
    $('projectorQuickStatus').textContent=ir.error||(ready?`${ir.hubName||'IR hub'} ready${galaxyText} · power state is not reported`:'Connecting to the IR hub…');
  }
  $('irRemote').addEventListener('change',()=>send({t:'ir',action:'select',remoteId:$('irRemote').value}));
  $('refreshIr').addEventListener('click',()=>send({t:'ir',action:'refresh'}));
  $$('[data-ir-main]').forEach(button=>button.addEventListener('click',()=>send({t:'ir',action:'press',button:button.dataset.irMain})));
  $$('[data-galaxy]').forEach(button=>button.addEventListener('click',()=>send({t:'galaxy-command',button:button.dataset.galaxy})));
  function renderGalaxy(){
    const galaxy=state.galaxy||{enabled:false,night:false,status:'loading',start:'20:00',end:'08:00'};
    $('galaxyEnabled').checked=!!galaxy.enabled;$('galaxyStart').value=galaxy.start||'20:00';$('galaxyEnd').value=galaxy.end||'08:00';
    const synced=galaxy.status==='synced';$('galaxyDot').classList.toggle('ready',synced);
    $('galaxyStatus').textContent=galaxy.error||(galaxy.status==='manual'?`Manual Galaxy ${galaxy.desired} sent · automatic sync resumes in 30 minutes`:galaxy.status==='sending'?`Sending Galaxy ${galaxy.desired}…`:galaxy.status==='waiting'?'Waiting for the HDMI signal to settle…':synced?`Night sync active · Galaxy ${galaxy.desired} command confirmed by Tuya`:galaxy.enabled&&!galaxy.night?'Outside the night window · no changes are made':galaxy.enabled?'Watching for Y9…':'Galaxy night sync is off');
  }
  function saveGalaxy(){send({t:'galaxy-settings',enabled:$('galaxyEnabled').checked,start:$('galaxyStart').value,end:$('galaxyEnd').value});}
  $('galaxyEnabled').addEventListener('change',saveGalaxy);$('galaxyStart').addEventListener('change',saveGalaxy);$('galaxyEnd').addEventListener('change',saveGalaxy);
  function haloDraft(){const halo=state.halo||{};return{enabled:$('haloEnabled').checked,alwaysOn:$('haloAlwaysOn').checked,mode:'app',intensity:Number($('haloIntensity').value)/100,points:halo.points||[{x:.08,y:.08},{x:.92,y:.08},{x:.92,y:.92},{x:.08,y:.92}]};}
  function renderHalo(){
    const halo=state.halo||{enabled:false,mode:'app',intensity:.35,points:[{x:.08,y:.08},{x:.92,y:.08},{x:.92,y:.92},{x:.08,y:.92}],guide:false,dynamic:{status:'off'}};
    $('haloEnabled').checked=!!halo.enabled;$('haloAlwaysOn').checked=halo.alwaysOn!==false;if(document.activeElement!==$('haloIntensity'))$('haloIntensity').value=Math.round((halo.intensity||.35)*100);$('haloIntensityValue').textContent=`${Math.round(Number($('haloIntensity').value))}%`;
    haloSelectedPoint=Number.isInteger(halo.selectedPoint)?halo.selectedPoint:haloSelectedPoint;const names=['Top left','Top right','Bottom right','Bottom left'];
    (halo.points||[]).forEach((point,index)=>{$(`haloPoint${index}`).textContent=`${(point.x*100).toFixed(2).replace(/\.00$/,'')}%, ${(point.y*100).toFixed(2).replace(/\.00$/,'')}%`;});
    $$('[data-halo-point]').forEach(button=>button.classList.toggle('on',Number(button.dataset.haloPoint)===haloSelectedPoint));$('haloSelected').textContent=`Moving point ${haloSelectedPoint+1} · ${names[haloSelectedPoint]}`;
    $('haloDot').classList.toggle('ready',!!halo.enabled);$('haloGuide').textContent=halo.guide?'Finish corner setup':'Show corner guide';
    const dynamic=halo.dynamic||{status:'off'};$('haloStatus').textContent=halo.error||(halo.guide?`Corner guide visible · point ${haloSelectedPoint+1} selected`:halo.enabled&&dynamic.status==='live'?'Dynamic picture colors live · fullscreen perspective fit active':halo.enabled&&dynamic.status==='starting'?'Starting dynamic picture sampling…':halo.enabled?`${dynamic.error||'Picture sampling unavailable'} · using app-color fallback`:'Halo is off. Your four corners are saved.');
  }
  function sendHalo(action){send({t:'halo',action,...haloDraft()});}
  const saveHalo=()=>{clearTimeout(haloPreviewTimer);sendHalo('save');};
  $('haloEnabled').addEventListener('change',saveHalo);$('haloAlwaysOn').addEventListener('change',saveHalo);$('haloIntensity').addEventListener('input',()=>{$('haloIntensityValue').textContent=`${$('haloIntensity').value}%`;clearTimeout(haloPreviewTimer);haloPreviewTimer=setTimeout(()=>sendHalo('preview'),16);});$('haloIntensity').addEventListener('change',saveHalo);
  $$('[data-halo-point]').forEach(button=>button.addEventListener('click',()=>{haloSelectedPoint=Number(button.dataset.haloPoint);$$('[data-halo-point]').forEach(item=>item.classList.toggle('on',item===button));$('haloSelected').textContent=`Moving point ${haloSelectedPoint+1} · ${['Top left','Top right','Bottom right','Bottom left'][haloSelectedPoint]}`;send({t:'halo',action:'select-point',point:haloSelectedPoint});}));
  $$('[data-halo-nudge]').forEach(button=>{let delay,repeat;const stop=()=>{clearTimeout(delay);clearInterval(repeat);};const move=()=>{const[dx,dy]=button.dataset.haloNudge.split(',').map(Number),step=Number($('haloStep').value);send({t:'halo',action:'nudge',point:haloSelectedPoint,dx:dx*step,dy:dy*step});};button.addEventListener('pointerdown',event=>{event.preventDefault();move();delay=setTimeout(()=>{repeat=setInterval(move,120);},420);});['pointerup','pointerleave','pointercancel'].forEach(name=>button.addEventListener(name,stop));button.addEventListener('click',event=>{if(event.detail===0)move();});});
  $('haloGuide').addEventListener('click',()=>{clearTimeout(haloPreviewTimer);send({t:'halo',action:'guide'});});$('haloReset').addEventListener('click',()=>{clearTimeout(haloPreviewTimer);send({t:'halo',action:'reset'});});
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
    document.body.dataset.tab = name;
    const main = document.querySelector('main');
    main.scrollTop = 0;
    document.scrollingElement.scrollTop = 0;
    if(name==='more')send({t:'audio',action:'refresh'});
  }
  $$('nav button').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));

  function setPad(which, manual) {
    if (manual) {
      manualPad = which === 'auto' ? '' : which;
      try {
        if (manualPad) phoneStorage?.setItem('lumen-pad', manualPad);
        else phoneStorage?.removeItem('lumen-pad');
      } catch { /* a denied preference must not disable the remote */ }
    }
    if (which === 'auto') which = state?.mode === 'home' ? 'dpad' : state?.navigation || 'touch';
    padMode=which;
    $('remoteControls').dataset.padMode=which;
    $('dpad').hidden = !['dpad','projector'].includes(which);
    $('touchpad').hidden = which !== 'touch';
    $$('#padseg button').forEach((button) => {
      const selected = button.dataset.pad === (manualPad || 'auto');
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    renderControlHint();
  }
  function renderControlHint() {
    const label = state?.focus?.label;
    $('controlHint').textContent = padMode==='projector'?'Arrows, OK, Back and Home control the projector':$('dpad').hidden ? 'Drag to point · tap to click' : label ? `OK · ${label}` : 'Arrows to move · OK to open';
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
      if (repeatable) timer = setTimeout(() => { const repeatMs=padMode==='projector'?360:105;interval = setInterval(() => { haptics.trigger('selection'); fn(); }, repeatMs); }, 360);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((name) => element.addEventListener(name, stop));
    element.addEventListener('click', event => { if (event.detail === 0) fn(); });
  }
  const projectorKeys={Up:'up',Down:'down',Left:'left',Right:'right',Enter:'ok',Back:'back'};
  $$('[data-key]').forEach((button) => bind(button, () => {
    const eligible=!!button.closest('#dpad')||(button.dataset.key==='Back'&&!!button.closest('.quick-row'));
    if(padMode==='projector'&&eligible&&projectorKeys[button.dataset.key])send({t:'ir',action:'press',button:projectorKeys[button.dataset.key]});
    else send({ t: 'key', k: button.dataset.key });
  }, button.dataset.repeat !== '0' && ['Up', 'Down', 'Left', 'Right', 'Backspace', 'Space'].includes(button.dataset.key)));
  $$('[data-media]').forEach((button) => bind(button, () => send({ t: 'media', a: button.dataset.media }), button.dataset.repeat === '1'));
  $$('[data-site]').forEach((button) => bind(button, () => send({ t: 'site', action: button.dataset.site }), false));
  bind($('home'),()=>send({t:'home'}),false);
  bind($('homeButton'),()=>padMode==='projector'?send({t:'ir',action:'press',button:'home'}):send({t:'home'}),false);

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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { reconnect(); keepAwake(); } else haptics.cancel(); });
  document.addEventListener('pointerdown', keepAwake, { once: true });
  window.addEventListener('online', reconnect);
  window.addEventListener('pageshow', event => { if (event.persisted) reconnect(); });
  window.addEventListener('offline', () => setConnection(false, 'Offline'));
  function resizeViewport() { document.documentElement.style.setProperty('--visible-height', `${Math.round(window.visualViewport?.height || innerHeight)}px`); }
  window.visualViewport?.addEventListener('resize', resizeViewport);
  resizeViewport();
  setPad(manualPad || 'dpad', false);
  connect();
})();
