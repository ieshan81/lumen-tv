# JoJo TV stitch kit

Reference stitch kit for Lumen TV and Watch JoJo. Lumen's current integration lives in `src/browser.js`, `src/tv-shell.js` and `src/popup-closer.js`; the snippets below document the original handoff. The Watch JoJo files are optional site-side helpers. Do not replace the current Lumen modules with these older copies.

Existing embed hosts, left unchanged:

- `ythd.org`
- `moviesapi.to`
- `player.videasy.to`
- `vidlink.pro`
- `vixsrc.to`
- `vidnest.fun`
- `supaplay.fun`

## Lumen tile

In `tiles.json`, the JoJo entry is configured with:

```json
{
  "id": "jojo",
  "name": "JoJo",
  "url": "https://watch-jojo.netlify.app/?lumen=1",
  "accent": "#d946ef",
  "desc": "Watch JoJo on the projector. Extra windows are closed.",
  "blockPopups": true,
  "adblock": true
}
```

`blockPopups: true` is what arms the closer. Leave it off for Netflix, Prime, and Disney+. The `?lumen=1` query only turns on the 10-foot frame. Playback stays on the current site.

## 1. Popup closer (Lumen)

Copy:

`lumen/popup-closer.js` → `src/popup-closer.js` (historical reference)

In `src/browser.js`:

1. At the top with the other requires:

```js
const popupCloser = require('./popup-closer');
```

2. At the end of `reset()`, add:

```js
popupCloser.stopPopupSweep(this);
```

3. In `_onEvent`, replace the `Target.targetCreated` popup block with:

```js
if (method === 'Target.targetCreated') {
  popupCloser.onTargetCreated(this, params.targetInfo);
}
```

Keep the other `targetInfoChanged` / `targetDestroyed` branches as they are.

4. In the `Target.attachedToTarget` branch, after `this.frameSessions.add(params.sessionId)`, add:

```js
popupCloser.onAttachedIframe(this, params.sessionId);
```

5. At the end of `open()`, after `place()`:

```js
await popupCloser.armPopupCloser(this);
```

6. At the start of `close()`, before `this.reset()`:

```js
popupCloser.stopPopupSweep(this);
```

What it does when `tile.blockPopups` is true and the tile URL is not Netflix, Prime, or Disney+:

- Every 350ms, `Target.getTargets` runs and every extra `page` target is closed. The main tile window, devtools, extension pages, and DRM hosts are left open. Iframe targets are not closed, so the player stays mounted.
- `Target.targetCreated` closes a new page immediately, without waiting for the sweep.
- `Page.addScriptToEvaluateOnNewDocument` plus `Runtime.evaluate` injects a `window.open` and `target="_blank"` blocker into the main page and into each attached iframe session.

What it does not do: it does not remove ads drawn inside the cross-origin embed. That page is the player. Closing it kills playback. A banner or preroll inside Videasy, ythd, moviesapi, Vidlink, Vixsrc, Vidnest, or SupaPlay can still appear. This kit only stops extra windows and parent-page `window.open` calls.

## 2. Parent-page popup guard (Watch JoJo)

Copy:

`watch-jojo/popup-guard.js` → `js/popup-guard.js` in the Watch JoJo repo (replace the current file).

`watch.html` already loads it:

```html
<script defer src="js/popup-guard.js"></script>
```

Do not sandbox `#player`. `StreamFlixPopupGuard.applyToIframe` still removes a sandbox attribute if one was set. Vixsrc and VidNest go black when sandboxed.

## 3. 10-foot frame (Watch JoJo)

Copy:

- `watch-jojo/tv-shell.css` → `css/tv-shell.css`
- `watch-jojo/tv-shell.js` → `js/tv-shell.js`

In `watch.html` `<head>`, after `watch.css`:

```html
<link rel="stylesheet" href="css/tv-shell.css">
```

Before `popup-guard.js`:

```html
<script src="js/tv-shell.js"></script>
```

The frame turns on only for `?lumen=1`. Phone and desktop visits without that query stay as they are. The CSS enlarges type and controls, adds a white focus ring, pads the 1920×1080 edges, and keeps playback controls visible without hover. It does not add a new player and does not list new sources.

`scripts/build.mjs` copies `css/` and `js/` into `dist`, so these two files are included on the next Watch JoJo build. Add nothing else to the build script.

## Check the closer

From this folder:

```text
node --test test/popup-closer.test.js
```

## Limits

- In-iframe ads cannot be deleted from the parent page or from Lumen without unloading the embed.
- Arrow keys often go into the iframe once it is focused. The shell does not steal Lumen's Home shortcut.
- `seek`, volume, and a true native play/pause still depend on the embed. This kit does not extract a media URL.
