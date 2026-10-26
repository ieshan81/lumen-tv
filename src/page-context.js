'use strict';

// Runs in the page's main world. Only field metadata is returned; never field values.
function readPageContext() {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const textTypes = ['text', 'search', 'email', 'password', 'url', 'tel', 'number'];
  const editable = active && !active.disabled && !active.readOnly &&
    (active.tagName === 'TEXTAREA' || active.isContentEditable || (active.tagName === 'INPUT' && textTypes.includes(active.type)));
  let input = null;
  let focus = null;
  // The browser controller validates the top-to-leaf frame focus chain. hasFocus() alone is
  // unreliable in an emulated-focus page when a cross-process iframe owns the actual field.
  if (editable) {
    if (!window.__lumenFields) window.__lumenFields = { nodes: new WeakMap(), current: null };
    const fields = window.__lumenFields;
    if (!fields.nodes.has(active)) fields.nodes.set(active, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    fields.current = active;
    const type = active.type || 'text';
    const label = active.getAttribute('aria-label') || active.labels?.[0]?.textContent || active.getAttribute('placeholder') || (type === 'password' ? 'Password' : 'Type on your TV');
    input = { fieldId: fields.nodes.get(active), type, label: String(label).trim().slice(0, 100), multiline: active.tagName === 'TEXTAREA' || active.isContentEditable, autocomplete: active.autocomplete || '' };
  }
  if (!editable && active && active !== document.body && active.matches('a,button,[role="button"],[role="tab"],[tabindex]')) {
    const label = active.getAttribute('aria-label') || active.querySelector('h3,h2')?.textContent || active.getAttribute('title') || active.textContent;
    if (label?.trim()) focus = { label:label.trim().replace(/\s+/g,' ').slice(0,100) };
  }
  const videos = Array.from(document.querySelectorAll('video,audio')).filter(v => {
    const r = v.getBoundingClientRect();
    return v.tagName === 'AUDIO' || (r.width > 10 && r.height > 10 && getComputedStyle(v).visibility !== 'hidden');
  });
  videos.sort((a, b) => Number(!b.paused && !b.ended) - Number(!a.paused && !a.ended) || (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
  const video = videos[0];
  let media = null;
  let site = null;
  if (video) {
    const quality = video.getVideoPlaybackQuality?.();
    let buffered = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) buffered = video.buffered.end(i) - video.currentTime;
    media = {
      page: 'player', title: document.title.slice(0, 160), playing: !video.paused && !video.ended,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      volume: video.volume, muted: video.muted, width: video.videoWidth || 0, height: video.videoHeight || 0,
      bufferedSeconds: Math.round(buffered), readyState: video.readyState,
      droppedFrames: quality?.droppedVideoFrames || 0, totalFrames: quality?.totalVideoFrames || 0,
      actions: { seek: Number.isFinite(video.duration) && video.duration > 0, previousEpisode: false, nextEpisode: false }
    };
  }
  if (window.LumenTV?.getState) {
    try {
      const raw = window.LumenTV.getState();
      if (raw && typeof raw === 'object') {
        const info = {};
        for (const key of ['title', 'series', 'artwork', 'page']) if (typeof raw[key] === 'string') info[key] = raw[key].slice(0, key === 'artwork' ? 2048 : 160);
        for (const key of ['season', 'episode']) if (raw[key] != null && Number.isFinite(Number(raw[key]))) info[key] = Number(raw[key]);
        site = { ...info, actions: {
          previousEpisode: typeof window.LumenTV.previousEpisode === 'function' && !document.querySelector('#prevEpisodeBtn')?.disabled,
          nextEpisode: typeof window.LumenTV.nextEpisode === 'function' && !document.querySelector('#nextEpisodeBtn')?.disabled
        } };
        // A shell with an embedded player must not mask the actual frame's media state.
        if (!media && (Number(raw.duration) > 0 || raw.playing)) media = { ...info, playing: !!raw.playing, currentTime: Number(raw.currentTime) || 0, duration: Number(raw.duration) || 0 };
        if (media) Object.assign(media, info, { actions: { ...media.actions, ...site.actions } });
      }
    } catch { /* a site hook is optional */ }
  }
  return { input, media, site, focus, activeFrame:!!active?.matches('iframe,frame'), navigation: document.documentElement.classList.contains('lumen-tv') || !!window.LumenTV ? 'dpad' : 'touch' };
}

function replaceFocusedField(fieldId, text) {
  const fields = window.__lumenFields;
  const node = fields?.current;
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (!node || !node.isConnected || fields.nodes.get(node) !== fieldId || active !== node || node.disabled || node.readOnly) return false;
  if (node.isContentEditable) node.textContent = text;
  else {
    const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, text);
  }
  node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}

module.exports = {
  CONTEXT_JS: `(${readPageContext.toString()})()`,
  replaceFieldExpression: (fieldId, text) => `(${replaceFocusedField.toString()})(${JSON.stringify(fieldId)},${JSON.stringify(text)})`
};
