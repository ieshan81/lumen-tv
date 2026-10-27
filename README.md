# Lumen TV

Turn on the projector, select HDMI, and tap **Start Lumen** on your phone. Lumen waits in the Windows tray, puts a
Google TV style home screen on the **Y9** display, switches sound to HDMI, and turns your phone into the remote.
No HDMI-CEC or smart-projector features are required.

Requires Windows, Microsoft Edge and Node.js. This repository includes the launcher, phone remote, shared TV layer,
and JoJo/Movy integrations. The external websites and their catalogs remain operated by their respective providers.
No streaming account, saved login, API credential or browser profile is included.

```
 laptop  --HDMI-->  projector (Y9)          phone (same Wi-Fi)
   |                    ^                          |
   |  tray app watches  |  fullscreen launcher     |  touchpad, d-pad, typing,
   |  for the display   |  + Edge for the apps     |  volume, home, sleep timer
   +--------------------+--------------------------+
```

## Run it

```
start.cmd            (or:  npm start)
```

The first run installs what Lumen needs automatically (needs Node.js). If you copy this folder to another PC, just run `start.cmd` there.

```
```

It lives in the system tray (purple play icon) and starts with Windows by default, so the phone remote stays
available. Right-click the tray icon to change that behavior or access diagnostics.

Windows Firewall blocks phones from reaching the laptop until you allow it once. If your phone opens the remote link
and the page never loads, that's why. Click the Lumen tray icon, then **Fix phone connection (Windows Firewall)**, and
approve the Windows prompt. It adds one narrow rule (one port, local network only). Lumen also warns you on the
projector if it's still blocked. Wi-Fi networks that Windows labels *Public* need this even if you clicked Allow on
the usual pop-up.

## First-time setup (2 minutes)

1. **Pair your phone once.** Open Lumen from the tray, go to TV home > System > Phone remote, and scan the QR code with
   your camera. (The home screen always opens first; the QR only shows when you ask for it.)
2. **Put the remote on your iPhone's Home Screen** so you never scan again: in the remote, open the **More** tab,
   press *Switch to the address that never changes*, then Safari's Share button > **Add to Home Screen**.
   Use that hostname address when saving the shortcut. A shortcut saved with the laptop's numeric Wi-Fi address
   can stop working after the router assigns a different address; scan the current TV code to pair again.
3. **Sign in once in Lumen's profile.** Open an app, then use phone **More > Sign in to current app**, or the tray's
   **TV browser: sign in / manage passwords** item. A normal Edge window opens with the same dedicated profile used
   on the projector, including Edge's password-save prompt. Sign in there and choose Save if you want autofill.
   Cookies and local storage remain in `%LOCALAPPDATA%\LumenTV\edge-profile`; Lumen never copies passwords into its settings.
   An account signed in through your everyday Chrome/Edge profile is separate. Services can still expire sessions.

### Why the remote isn't on Netlify

The remote page is served by the laptop itself, on your home Wi-Fi. A page hosted on Netlify is HTTPS, and browsers
refuse to let an HTTPS page talk to a plain `http://` device on your network, so it could never reach the laptop. The
only way around that is a cloud relay that can control your PC from the internet, which isn't worth the risk. The
`.local` address (your computer's name, for example `http://YourPC.local:4321/`) gives the same result: one icon,
and it keeps working when the router changes the laptop's IP. If you ever want it to work away from home, install
Tailscale on the laptop and phone and use the laptop's Tailscale address.

Apps open in **Microsoft Edge** (in its own clean profile) rather than inside Lumen, because Netflix and similar
services need a supported browser and DRM. The available resolution depends on the provider, subscription and display.
That profile is separate from your normal Edge: it never signs in
to your Microsoft account, never syncs, and has none of your extensions.

## Using it

| Where | What |
| --- | --- |
| Launcher | Arrow keys + Enter, or the phone's D-pad. Esc / Back returns to the app you paused. |
| Inside an app | Phone touchpad moves an on-screen mouse (kept on the projector), tap = click, two fingers = scroll, two-finger tap = right click. D-pad, keyboard, play/pause and Back work too. |
| Anywhere | **Ctrl+Shift+H** or **Alt+Home** (or the phone's Home button) pauses the video and returns to the TV home. |
| Phone > Type | Types text on the TV wherever the cursor is. |
| TV text field | The Remote tab automatically presents a matching phone input. Live edits go only to that field; password values are never broadcast. Safari may require tapping the field to open its keyboard. |
| Play / Pause | Uses Windows' headset media key, rather than sending Space into a form. The icon follows the actual detected player state, including embedded frames. |
| Phone > More > Audio & volume | Choose an active Windows output, such as HDMI, speakers or headphones. Lumen verifies the change and remembers the device for the next TV session. Refresh the list after connecting a device. |
| Volume display | Shows the measured Windows volume on the projector. Auto-hide is on by default; switch it off to keep the display visible, then use Hide volume display to dismiss it. |
| Sleep timer | TV home > System > Sleep timer (or the phone's *More* tab). Pauses, closes the app, leaves TV mode and stops the video signal so the projector can go to standby. |

When the projector is unplugged (or you pick *Exit TV mode*) everything is put back: the browser closes cleanly,
the screen can sleep again, and sound returns to the device you were using.

### Starting from bed

1. Turn on the projector with its native remote and select HDMI.
2. Open the saved Lumen icon on your phone.
3. Tap **Start Lumen**. The remote shows each stage while Windows enables the display, opens the launcher, and
   switches audio. If Windows cannot see Y9, it gives you a useful retry message instead of failing silently.

The laptop must be awake and signed in because the phone connects directly to Lumen over your home network. Lumen
does not attempt to power the projector on and does not require CEC.

### The phone works whichever window is focused

Input from the phone is sent straight into the website's page (not through the Windows keyboard), and the page is
told it is focused. So the remote keeps working even if another program is in front on the laptop, and it never types
into the wrong window. The launcher and the Home button work the same way. The one exception is a program started
with an `exe` tile (like VLC): that uses normal keyboard input, so it needs to be the focused window. Play/Pause and
Play/Pause can use Windows media keys, like headset controls. Volume uses Windows Core Audio and reports the actual
selected output's level; the projector's own hardware volume remains controlled by its native remote.

### Picture quality and the shared interface

HBO Max replaces Twitch in the app list. Movy sits beside Watch JoJo on both the TV home and phone Apps tab.
The launcher, shared TV presentation layer and phone remote use consistent
colors, spacing and focus indicators. The local Watch JoJo layer is applied on navigation, so internal links do not
need to carry `?lumen=1`. Reopening the current app no longer forces a reload with a new query string.

During playback, the phone shows the decoded resolution, seconds buffered and excessive dropped frames when the
player exposes those values. Lumen does not invent quality readings or override a service's DRM restrictions.
The hidden launcher suspends its animations and background state rendering during movies. The TV shell avoids
automatic catalog focus scans during visible playback, and the tray menu is rebuilt only when its state changes.
For example, [HBO's browser troubleshooting page](https://help.hbomax.com/us-en/answer/detail/000002521) currently lists
720p as the highest resolution at HBOMax.com. A supported TV device may offer different limits.

The interface follows [Android TV navigation principles](https://developer.android.com/training/tv/get-started/navigation):
visible focus, predictable Back/Home, and reachable controls. Mobile controls support narrow phones, landscape,
reduced motion, keyboard access and safe-area insets. Automatic focus is best effort because
[iOS restricts programmatic software keyboards](https://bugs.webkit.org/show_bug.cgi?id=195884).

### Development verification

`npm run check` checks all application scripts. `npm test` includes a real headless Edge fixture that verifies
persistent cookies/local storage across restart, password-field privacy, cross-origin frame detection, Enter,
play/pause, seeking and the Windows-media-key routing contract. No real account is used by that test.

For visual checks, `node scripts/preview-remote.js` starts a synthetic, local-only preview at
`http://127.0.0.1:14321/?t=preview`. It never controls the desktop. `node scripts/capture-remote.js` captures that
fixture to `cache/verification/remote-phone.png`.

## Adding your own apps and sites

Edit `tiles.json` (tray > *Edit tiles*, then *Reload tiles*):

```json
{
  "id": "movies",
  "name": "Movies",
  "url": "https://your-movie-site.example/",
  "accent": "#7c5cff",
  "desc": "Shown under the title when the tile is focused.",
  "blockPopups": true
}
```

| Field | Meaning |
| --- | --- |
| `id`, `name`, `url` | Required. `id` is a unique short name. |
| `accent` | Colour of the tile and the whole backdrop while focused. |
| `blockPopups` | Close any extra window the site opens (good for streaming sites full of ad popups). Leave off for sites that use a login popup. |
| `adblock` | Built-in ad blocking: strips ads out of YouTube's player data (the same trick uBlock Origin uses), hides ad slots, skips any ad that still appears, and blocks common ad servers. On for the YouTube tile. No extension needed. |
| `tvUserAgent` | Make the site think it's on a TV. YouTube uses this to serve its big-screen layout. |
| `tvShell` | Opt into Lumen's TV focus/navigation layer. Enabled for JoJo and Movy; not injected into third-party player frames. |
| `lockNavigation` | Keep the main app window on its configured origin, blocking unrelated top-level redirects. Enabled for Movy. Embedded player requests are not restricted by this option. |
| `allowedNavigationOrigins` | Explicit extra origins for a navigation-locked app, e.g. `https://movy.sx` alongside `https://www.movy.sx`. This is not a wildcard list. |
| `exe` / `args` | Instead of `url`: launch a program (for example VLC) and use its own controls. |

Icons are downloaded once per site (just the domain goes to Google's favicon service). Turn that off with
`"fetchIcons": false` in `settings.json`, and tiles fall back to a coloured letter.

## Settings (`settings.json`, created on first run)

| Setting | Default | |
| --- | --- | --- |
| `autoTvMode` | `false` | Optional legacy behavior: enter TV mode automatically when the projector connects. The default is phone-first. |
| `runAtStartup` | `true` | Start Lumen with Windows so the phone remote is available. |
| `projector.match` | `"Y9"` | Part of the monitor name Windows shows for the projector. |
| `forceExtend` | `true` | If Windows is *mirroring* the projector, switch to **Extend** so only the projector shows the TV UI. |
| `audio.switchToProjector` | `true` | Use the projector's audio while in TV mode, then restore. `audio.deviceMatch` picks a different device by name. |
| `audio.deviceId` | unset | Exact Windows output chosen in More. A disconnected saved output is reported rather than silently selecting another device. |
| `audio.volumeAutoHide` | `true` | Hide the TV volume display after about 2 seconds. When false, use Hide volume display to dismiss it. |
| `homeHotkeys` | `["Ctrl+Shift+H","Alt+Home"]` | Global "go home" keys. |
| `remote.port` / `remote.token` | `4321` / random | The phone remote's port and secret. Delete the token line to get a new one. |
| `remote.projectorWaitSeconds` | `18` | How long the Start button waits for Windows to expose Y9 after enabling Extend mode. |
| `sleepTimer.turnOffProjector` | `true` | After the sleep timer, stop sending video so the projector can standby. |
| `browser.path` | auto | Path to `msedge.exe` if Edge is somewhere unusual. |

The phone remote is protected by the secret in the link/QR code. Anyone on your Wi-Fi without the link gets a 401.

`settings.json` is generated on first run with a fresh pairing secret. `settings.example.json` contains portable defaults.
Local settings, `.env` files, browser profiles, logs and the cache are excluded from Git. Each person signs into
their own streaming services in Lumen's separate Edge profile. The remote is intended for a trusted local network;
do not forward its port to the internet.

## Tips

- **Laptop lid closed?** Windows normally sleeps when you close the lid. To keep it running (while plugged in), run once:
  `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0` then `powercfg /setactive SCHEME_CURRENT`
- **Waking up after the sleep timer:** the phone remote still works. Open it and press *More > Start TV mode*.
- **YouTube ads:** blocking is best effort. YouTube changes things now and then and runs its own anti-ad-blocker
  checks, so if ads or a warning ever come back, the code is in `src/adblock.js`. For other sites, add
  `"adblock": true` to that tile, or manage extensions in the TV browser (tray > *TV browser: sign in / manage passwords*).
- **Phone still can't load the page?** (1) The phone must be on the same Wi-Fi as the laptop, not mobile data.
  (2) Some Wi-Fi networks (dorms, campuses, guest networks) isolate devices from each other, so nothing on the network
  can reach the laptop. In that case turn on the laptop's Mobile Hotspot and join it from the phone, or install
  Tailscale on both and use the laptop's Tailscale address.
- **Log file:** `cache/lumen.log` (what it detected and did).
- **Trying it without touching sound or power:** `npm run dev` opens the launcher in a normal window.

## How it works

`main.js` ties it together. `src/displays.js` finds the Y9 and (via WMI) spots a mirrored projector. `src/browser.js`
launches Edge with a debug port and controls it over the DevTools protocol (place it on the projector, pause video,
close popups). `src/input.js` sends real keyboard and mouse input and focuses the browser window. `src/remote.js`
serves the phone remote. `src/audio.js` + `scripts/audio.ps1` switch the sound output. `src/adblock.js` is the ad blocker. `ui/` is the launcher and
`remote/` is the phone page.

### Watch JoJo integration

Lumen recognizes a site-provided `window.LumenTV.getState()` API when available. That lets the phone remote show the
episode title, season, episode, play state, and progress. `window.LumenTV.togglePlay()` and
`window.LumenTV.seekBy(seconds)` are used for native controls when present. If the site also exposes
`previousEpisode()` or `nextEpisode()`, those controls appear automatically on the phone. Ordinary sites continue
to work through the standard HTML video fallback.

### Movy on the TV and phone

Choose **Movy** on the TV home or phone **Apps** tab. In the phone's **Auto** control mode, Movy and JoJo use
the D-pad: arrows move the visible focus ring, **OK** opens the selection, and the phone shows the focused
title/control. Left/right stay in the same title rail and scroll it as needed. Dialogs keep focus inside
them and restore it when closed. **Back** closes search/dialogs first, then returns through that app's history;
from its root it returns to Lumen home. **Home** always returns to Lumen.

Open Movy's **Search** and the phone typing panel appears for that field. Safari may still require a tap
to open its software keyboard. **Navigate** and **Touchpad** are manual overrides; choose **Auto** to restore
site-aware behavior. Standard playback detection, headset-style Play/Pause, ±10-second seeking and picture
information use the same controller as the other apps when the embedded player exposes them. Episode and menu
buttons use supported site hooks or the actual player DOM; controls that are absent, disabled or ambiguous are hidden.

Movy is an external website, not a bundled native Netflix client. Its availability, catalog, player controls
and source quality can change. Lumen does not download its media or replace its player providers. During inspection,
the site opened an unsolicited extension-install ad. Lumen blocks popups, the observed ad hosts and off-origin
top-level redirects for this tile. Do not install extensions advertised by those popups. If an external account
flow is needed, use **More > Sign in to current app**, which opens the normal dedicated Edge profile.

### Phone haptics

**More > Haptic feedback** controls vibration on that phone only, with a **Test haptics** button. Supported
browsers use short navigation ticks, firmer OK/Play/Pause/Home taps and a double pulse for Start. Touchpad taps
also give feedback, without buzzing continuously while dragging. Rapid duplicate events are throttled; switching
the option off or hiding the page cancels vibration. The preference survives a phone-page reload.

Haptics are best effort, not confirmation that a command reached the TV. [Safari on iPhone does not expose the
Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate#browser_compatibility); the remote
shows an unsupported-browser notice there and retains visual pressed-state feedback. Silent mode, device settings
or hardware can also suppress a pulse even when the browser accepts the request. Lumen does not install extensions,
request notification permissions or use hidden control tricks to simulate support.

### Episode and player-menu controls

During a show, the remote can expose **Next episode**, **Previous episode**, **Episodes**, **Audio & subtitles**,
**Quality & speed**, **Skip intro** and **Skip recap**, only when a corresponding enabled control exists.
Movy's observed player uses a Next Episode link and native Episodes/Audio & Subtitles/Quality buttons rather
than `window.LumenTV` hooks. Lumen scopes discovery to the player, supports its auto-hidden control bar, and
validates next/previous Movy links against the current show's origin and route. It does not invent a previous
episode by subtracting a URL number or treat an ordinary carousel Next arrow as an episode control.

The menu buttons open the website's own TV menus; use the D-pad to choose an episode, subtitle/audio track,
quality or speed. **Back** closes a tracked menu before navigating away. Existing JoJo integration hooks take
priority, and player-frame controls are routed into the actual media frame. DOM targets and disabled state are
checked again on each tap; stale-page and ambiguous targets are rejected. Native website DOM changes can still
require an adapter update. No subtitle file upload, account change, source selection or episode skip occurs merely
because the remote detects these controls.

### Projector recognition and volume display

Lumen now combines active-screen names with Windows monitor hardware identity and remembers the confirmed
projector in `cache/projector-identity.json`. This tolerates a generic display label or changed screen ID when
Windows still exposes the same monitor hardware. Ambiguous matches are not guessed. Under phone **More >
Projector recognition**, choose an external display and **Remember this screen** if necessary. Switching to a
different screen closes the current app after confirmation. The existing projector startup preference is preserved.

Brief HDMI handshake losses get a 3.5-second grace period before Lumen closes the TV session. On recovery it
rechecks placement; a sustained disconnection still exits TV mode and restores the previous audio output.

Volume Up/Down/Mute now use the Windows audio endpoint and show a bottom-center TV overlay with the measured
percentage, mute state and output-device name. The overlay is click-through, does not take focus from the player,
and hides after about two seconds. Changes from laptop/headset volume controls are also observed during TV mode.
The phone shows the same level. **More > Projector recognition > Show volume on TV** displays the current reading
without changing it. Unavailable audio produces an error state, never a guessed percentage.

This is Windows output volume, not the projector's separate IR-remote amplifier setting, and does not prove that
physical sound reached the room. The projector still needs its own remote to power on and select HDMI.
