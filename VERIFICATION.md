# Lumen TV verification

## Cinematic home, Movy history and local Jarvis — November 2, 2026

- Rebuilt the live projector home with cached TMDB backdrops, cinematic spotlight rotation, a superhero-tech HUD,
  flying dock focus indicator, Continue Watching progress and a Jarvis recommendations shelf. The spotlight owns OK
  after the interface becomes idle, while any directional input restores explicit shelf focus.
- Rebuilt the phone UI around two destinations, Remote and Room. Player, episode, keyboard, pointer, projector D-pad,
  routed volume, Galaxy, audio output and four-point controls remain adaptive. The synthetic Edge fixture passed at
  320×568, 390×844 and 844×390 with no horizontal overflow.
- Replaced circular numbered calibration dots with dual-stroke precision crosshairs. The underlying four-point
  homography, in-place nudging and real-time Halo renderer are unchanged.
- Added a DPAPI-protected TMDB credential store, six-hour catalog cache and local watch-history store. Movy's real
  Continue Watching rail was imported from its rendered DOM without reading or storing its account token. The live
  rail supplied Dead-End Job, Chernobyl, American Horror Story, Family Guy S9E18 and F1 with exact episode routes,
  artwork, timestamps and progress.
- Added Jarvis using Windows' installed offline en-US speech engine and deterministic intents, not a resident LLM.
  The live recommendation request returned 18 Indonesian horror titles. A live “continue our Family Guy episode”
  request opened `/tv/1434/9/18?play=true`, restored near 16:20 and was observed playing at 16:49/21:51. A live
  Mrwhosetheboss request opened YouTube search sorted by upload date.
- `npm run check` passed and `npm test` passed all 51 tests. The launcher and phone were visually inspected after a
  production restart; Lumen was left running on Home. Software evidence does not prove microphone pickup from the
  user's physical room position or iPhone haptics, which still require a native iOS wrapper.

## Feathered real-time Halo and Movy popup containment — November 2, 2026

- Replaced repeated `desktopCapturer.getSources()` thumbnail polling with one continuous Y9 media stream in the Halo renderer. Frames are reduced to 192×108 for thirty-six near-boundary color samples on a 32 ms gate, smoothed and painted directly without a renderer-to-main-process round trip. Fast attack follows large scene changes while a slower fall prevents one dark frame from flickering the wall. The remote still receives explicit `starting`, `live` and protected/black-frame `fallback` states.
- Added a 480×270 captured-frame extension in three depths: a close 6-pixel texture blur, a 20-pixel bloom and a 48-pixel broad wash, which scale to roughly 24/80/190 pixels on Y9. These retain spatial detail from the real picture instead of reducing each side to three colors. Thirty-six calibrated edge bands provide far-field support and the protected-video fallback. The phone brightness control spans 4–100%; this production Y9 is set to 72%.
- The movie quadrilateral remains completely transparent, while four multiplicative border masks reach zero alpha at every projector-raster edge. The transparent Halo window is marked capture-protected so its display capture sees the underlying movie rather than recursively amplifying previous Halo frames. A controlled red/blue protected-renderer test measured a 119 ms median and 151 ms p95 across ten post-warmup transitions; the outermost pixel was transparent black. `scripts/measure-halo-latency.js` repeats this diagnostic when Lumen is started with diagnostic port 9334.
- A five-second live renderer sample maintained a 4.3 ms p95 animation interval and spent about 6.4% of elapsed time in renderer tasks. `cache/verification/halo-edge-extension-layer.png` is the real capture-protected Halo layer. `cache/verification/halo-edge-extension-composite.png` combines near-concurrent underlying-Y9 and protected-layer captures for visual inspection; it is not a single camera photograph of the wall.
- Removed the browser reposition from corner nudge/reset/save operations. `scripts/check-halo-corner-live.js` moved and exactly restored a real saved point while polling the production Edge window 23 times; every sample remained `fullscreen`, and the prior guide state was restored.
- Chromium's unavoidable bottom-left link preview is prevented by keeping TV links under Lumen-owned visual focus rather than native anchor focus. Enter still activates the selected link exactly once, focus labels still reach the phone and native button/form behavior remains intact. `cache/verification/halo-prominent-live.png` is a direct Y9 raster capture with Movy focused, a prominent multi-color Halo, no taskbar/titlebar and no link-preview bubble.
- Reproduced Movy's black Opera-GX interruption and established that it was not a JavaScript alert: the site injected a sandboxed `about:srcdoc` iframe with `allow-popups allow-modals`, a fake browser-dialog UI and `$G$` postMessage/open handlers. The payload was visible in a flattened DOM snapshot while absent from the top document's visible text and dialog selectors.
- `src/popup-closer.js` now permanently locks popup/dialog APIs for opted-in tiles, intercepts the suspicious `HTMLIFrameElement.srcdoc` payload before rendering and removes copies inserted through other DOM paths. DRM/account providers remain excluded from this protection.
- The restarted production build ran the real `https://www.movy.sx/` catalog beyond the previous delayed reproduction point. Its exact hostile `srcdoc` probe was rejected, three real frame-insertion attempts were counted and removed, and the observation reported zero native dialogs, extra pages, visible Opera overlays, surviving Opera `srcdoc` frames or off-origin navigations. `cache/verification/movy-clean-smooth-halo-final.png` and `cache/verification/halo-prominent-live.png` are direct Y9 raster captures after those runs.
- The API-level popup design was cross-checked against AdGuard's public PopupBlocker project; no advertised extension, browser add-on or third-party executable was installed. Lumen keeps the narrow per-tile protections under its own test coverage.
- Final validation passed: `npm run check`, all 48 automated tests, `npm audit --omit=dev` with zero reported vulnerabilities and `git diff --check`.

## Manual screen frame and overspill Halo — November 1, 2026

- Removed the camera/color-correction workflow and kept Halo as a geometry plus ambient-light feature. The phone now exposes four independently selectable cloth corners in clockwise order, a directional nudge pad, 0.25%/0.5%/1% step sizes, reset and a numbered projector guide. Server-side validation rejects collapsed, crossed, off-raster or stale geometry. Legacy Left/Top/Right/Bottom settings migrate to equivalent points before defaults are merged.
- The launcher and Edge remain fullscreen across the complete Y9 raster. A projective CSS homography maps their source rectangle to the saved quadrilateral, while a transparent click-through, focusless, always-on-top Electron renderer owns the overspill. The center quadrilateral is cut completely clear. This separates Windows chrome suppression from cloth fitting: neither the Edge title bar nor taskbar needs to sit inside the projected image.
- `src/ambient.js` captures a 320×180 Y9 thumbnail around four times per second, samples three positions along each edge, converts the Windows bitmap to sRGB colors and smooths successive results. Black/protected/unavailable captures fall back to the current app accent and report `fallback`; live captures report `live`. The fallback is deliberate and does not claim DRM bypass.
- `npm run check` passed. `npm test` passed all 45 tests, including exact four-corner homography, legacy migration, hostile/folded-setting rejection, 12-zone sampling, protected-frame fallback, fullscreen placement, transparent overlay focus/Z-order, authenticated phone command delivery and no horizontal overflow at 320×568, 390×844 and 844×390.
- Live authenticated state reported Y9 connected, YouTube active, Halo enabled at 40%, the preserved prior alignment converted to four points, guide hidden and dynamic status `live`. A live test selected point 1, moved it by 0.25%, observed the saved geometry change, moved it back exactly and hid the guide. The prior YouTube URL was restored at 486.720843 seconds and left paused.
- `cache/verification/halo-y9-live.png` and `cache/verification/halo-y9-video.png` are direct Windows captures of the real Y9 raster. They show fullscreen content with no Windows taskbar or Edge title bar and independently colored overspill. `cache/verification/halo-remote.png` is synthetic phone-layout evidence, not a photograph of the physical wall.
- Physical optical alignment and the perceived light on the wall still require the user to place all four numbered points while looking at the cloth. Software capture verifies the Y9 raster, homography and live sampling; it does not prove the projector's optical keystone, wall color, camera exposure, DRM-provider capture behavior or in-room appearance.

## Phone reconnection recovery — October 27, 2026

- The production server was running on all IPv4 interfaces with an existing local-subnet firewall allowance. Authenticated HTTP and WebSocket requests succeeded using both localhost and the current Wi-Fi address. The numeric Wi-Fi address had changed since the preceding session; an old numeric shortcut cannot reach the new address.
- Phone wake, network-online and back/forward-cache restoration now retire an existing socket and open a fresh authenticated connection. Pending connections have a bounded timeout. Messages from retired sockets are ignored.
- Denied browser storage no longer prevents initialization or changing the control mode. Preferences remain in memory when persistence is unavailable.
- The Edge phone fixture verifies restoration/online replacement, one active client, one delivered action after reconnect, and usable controls with storage denied. These are browser-level checks; reachability from the user's physical phone still needs its direct confirmation.

## Playback overhead, output selection and volume preferences — October 26, 2026

- The running application had not loaded the previous volume-display update. With restart approval, Lumen was restarted and the same movie resumed near the captured position using the provider's saved progress.
- Native inspection confirmed the real, click-through volume overlay on Y9. Remote volume down changed Windows from 100% to 98%, and volume up restored 100%.
- A post-restart 29.6-second movie sample reported 722 video frames, zero additional dropped frames, about 30 seconds buffered and `readyState: 4`. This is a sampled software measurement; it does not establish the projector's perceived motion smoothness.
- Hidden-launcher background throttling, paused backdrop animations and skipped hidden-renderer updates reduce background work. Tray menus update on relevant changes. During visible playback the shared TV shell avoids automatic catalog focus scans and removes its backdrop blur.
- More > Audio & volume lists active Windows rendering endpoints via Core Audio. A choice is revalidated, switched and verified against Windows; failed verification attempts to restore the prior output. The selected identity is saved locally. Normal TV exit retains the original output restoration behavior.
- The room's volume auto-hide preference is saved locally. It supports automatic dismissal, a pinned display, and an explicit Hide action.
- `npm run check` and all 26 tests pass, including device selection/rollback, disconnected saved devices, timer cancellation/pinning and responsive phone settings at 320x568, 390x844 and 844x390. Windows reported five real active outputs; selecting the current Y9 output was confirmed as an unchanged operation.
- After activation, authenticated live remote commands switched the actual Windows output from Y9 to Realtek speakers and back to Y9, with each result confirmed from Core Audio. The pinned overlay remained visible beyond 3 seconds, explicit Hide dismissed it, and re-enabled auto-hide dismissed it automatically. Local settings contained the chosen output and auto-hide preference. The movie was restored to the captured position and its paused state preserved.
- Historical sections below describe their delivery-time activation boundaries; the earlier volume update is now active.

## Episode and player-menu DOM controls — October 25, 2026

- Inspected Movy's public series/player DOM in a separate temporary browser tab, not the user's TV profile. Found the real Next Episode anchor, `#ButtonPlay` player control and semantic Episodes, Audio & Subtitles and Quality buttons. The Quality menu also contains speed controls. The Next Episode link was inspected but not clicked. Temporary inspection/ad tabs were closed without installing or downloading anything.
- Added a serialized DOM adapter in `src/site-controls.js` with an explicit action allowlist. Known native auto-hidden controls remain available. Absent, disabled, ambiguous and wrong-show/off-origin Movy targets are rejected. JoJo's supported episode hooks retain priority.
- The browser maps each capability to its root-page or active-media-frame context. It re-queries the DOM and checks the originating page key before execution. An empty parent-page hook cannot mask a working embedded-player action.
- Phone buttons now include native episode navigation and optional Episodes, Audio & subtitles, Quality & speed, Skip intro and Skip recap actions. Only detected capabilities appear, including while a player buffers. Menus remain owned by the site; detected sibling panels receive TV focus and Back closes them.
- `npm run check` and `npm test` pass (24 tests). Added real headless Edge fixtures for Movy-shaped DOM without hooks, auto-hidden controls, menu focus/Back, disabled and stale targets, wrong destinations, ambiguity, hook priority and cross-origin frame routing. The phone fixture verifies capability-based visibility and single action delivery.
- `cache/verification/episode-remote.png` is synthetic remote UI evidence, not a screenshot of the user's player. Provider subtitle/quality menu choices and real episode navigation were not changed during verification.
- The prior request to avoid restarting Lumen remains respected. This integration and the preceding volume/recognition update activate on the next Lumen restart; refresh the phone page afterward. Live provider navigation/menu behavior still needs a room-session check after activation.

## Recognition and volume display — October 25, 2026

- Added Windows monitor identity/desktop-bounds correlation, remembered identity with a conservative screen-ID fallback, name aliases and ambiguity rejection. The phone exposes a projector selector and recognition reason. Hardware IDs stay local, outside remote broadcasts.
- A manually chosen unavailable projector is not replaced by a different screen. Brief HDMI losses wait 3.5 seconds before closing the session; recovery rechecks browser placement.
- Added a persistent local Core Audio worker and measured volume/mute snapshots. Commands are bounded; polling reads coalesce while user commands retain order. Endpoint failures do not generate optimistic volume numbers.
- Added a non-focusable, click-through, always-on-top volume window on the chosen TV. It displays the level, mute state and device, resets its auto-hide timer on repeated input, and closes when TV mode exits. The remote shows volume and has a read-only Show volume on TV action.
- `npm run check` and `npm test` pass (21 tests), including display selection, hardware/name/ID changes, ambiguous and missing selection, worker lifecycle/validation, overlay placement/focus/auto-hide, renderer percentage/mute/error states and phone control delivery.
- A read-only native Windows inventory mapped the connected Y9 to its hardware identity. The read-only Electron probe selected Y9 and verified that the same real inventory still selects it under a simulated generic label and changed screen ID. Run `node_modules/electron/dist/electron.exe scripts/check-tv-detection.js` for that diagnostic.
- A read-only Core Audio query returned the real Y9 output name, level and mute state. No live volume change was made while the user watched Movy.
- `cache/verification/volume-overlay.png` is a synthetic renderer preview, explicitly labeled synthetic; it is not an in-room screenshot.

### Activation boundary for this update

The user asked to leave Movy playback running and restart later. Lumen was not restarted or reconfigured live for this update. The new main-process detection, Core Audio controller and overlay therefore activate on the next restart. Physical hotplug recovery, on-projector overlay visibility and volume-button changes remain pending that room-device check. Windows output volume remains independent of the projector's own IR-controlled volume.

## Movy integration — October 24, 2026

- Movy is configured immediately beside JoJo in `tiles.json`; both lists are generated from that catalog.
- Both apps opt into the same origin-scoped TV shell. The shell leaves cross-origin player frames unchanged.
- D-pad focus skips disabled, invisible, inactive-slide and duplicate nested controls. Horizontal navigation stays in its rail and scrolls the selected title into view. Dialogs contain focus and restore it on close.
- Back closes Movy search first, sends Escape to an open dialog, follows same-app history, then requests Lumen home at the app root.
- The phone displays the selected TV control/title. Its new Auto option restores site-aware controls after a manual Navigate/Touchpad override.
- Actual iframe focus ownership is followed through browser frame IDs. An inactive frame cannot keep the keyboard open or accept a stale edit, even when `document.hasFocus()` is unreliable under focus emulation. No field values are broadcast.
- Movy's first navigation begins from a blank page after protections are armed. Off-origin top-level navigations are aborted before requesting the unrelated page; embedded player/API requests remain independent. The known unsolicited extension-ad hosts observed in browser inspection are blocked. No advertised extension was installed.
- Popup initialization scripts are removed when switching to a non-popup-blocked app. Account setup windows retain their existing exception.

### Current automated evidence

- `npm run check`: passed.
- `npm test`: 14 tests passed, including real headless Edge fixtures for TV navigation, remote UI, persistent storage, typing, embedded playback and seeking, plus haptics contracts.
- The TV fixture verifies rail scrolling/edge behavior, modal focus containment/restoration, search-to-phone metadata, Back/history/root Home, shell reapplication on internal navigation and an aborted off-origin document request that leaves the catalog intact.
- The phone fixture verifies Movy in Apps, Auto/manual control modes, selected-title hints, targeted live typing, stateful Play/Pause and picture metadata. It checks 320×568, 390×844 and 844×390 without horizontal overflow.
- `cache/verification/movy-phone.png` is generated from the synthetic phone fixture. Its header explicitly labels it a design preview, not a real Movy playback session.
- After the user approved restarting, Electron was updated to 44.9.3 and undici to 7.30.1. Installed package files and the Electron executable's product version were checked, not just the lockfile. `npm audit --omit=dev` reports zero vulnerabilities. The project's postinstall now explicitly installs the Electron binary for clean installs.
- Haptics use 10 ms navigation ticks, 18 ms main-control taps and a bounded double pulse for Start/Test. Duplicate pulses are throttled. A per-phone preference and Test button are available under More. Tests verify patterns, throttling, off/persistence/reload, hidden/unsupported/denied browsers, no duplicate test pulse and authenticated asset delivery. These checks prove software behavior, not physical phone vibration.

### Activation and live-test boundary

The user approved restarting. The old TV session was stopped through Lumen's normal exit flow, the application and its owned child processes were stopped for maintenance, and Lumen was relaunched with the updated Electron binary. The authenticated production remote reports Home mode, Y9 connected, Y9 audio ready and JoJo/Movy/YouTube/Netflix/Prime Video/Disney+/HBO Max/Web in the catalog. Its current page contains the haptic setting and its authenticated haptics script returns HTTP 200. The settings SHA-256 is identical before and after maintenance; the existing browser profile was preserved. Refresh the phone remote to load the new scripts.

The public Movy catalog, navigation/search markup and unsolicited ad behavior were inspected. Live Movy playback, real iPhone Safari keyboard behavior and this update's in-room remote interaction have not been verified. Embedded controls work only when the provider exposes a compatible HTML media element or supported integration hook. This is an external-site integration, not a native Netflix client or a guarantee of every provider's behavior.

Safari on iPhone does not expose the standard Vibration API; the remote displays that limitation and disables the haptic setting/test there. Visual pressed states remain available. Supporting actual iPhone remote-button haptics would require a separately scoped native application/bridge; this update does not claim that capability.

## Previous delivery — October 17, 2026

## Delivered behavior

- HBO Max replaces Twitch in the launcher and phone app list.
- A shared presentation layer applies to Watch JoJo within Lumen, including internal page navigation. Its existing media providers remain unchanged.
- Reopening the current JoJo tile no longer generates a cache-busting query or forces a page reload.
- Sign-in windows use the existing `%LOCALAPPDATA%\LumenTV\edge-profile` and expose Edge's normal password-save UI. The existing saved-login database was preserved.
- Play/Pause routes through Windows' media Play/Pause key, the same key category as headset buttons. It no longer injects Space into the page.
- Default execution contexts are tracked in the root page and nested cross-origin frames. The phone displays actual playback state, decoded dimensions, buffering and excessive dropped frames when available.
- Focused input metadata triggers a matching phone typing panel. No existing field value or password is sent in state broadcasts. Live edits validate the field identity and reject stale targets.
- Phone layout adapts to navigation, pointer control and playback, and supports portrait, landscape, small screens, reduced motion and keyboard access.
- Account windows are exempt from the JoJo popup cleanup while sign-in mode is open. HBO Max is a protected provider.
- A reconnect no longer creates duplicate open WebSocket connections. App tiles are not rebuilt on every media-time update.

## Evidence

- `npm run check`: passed for main process, browser/controller, page context, TV shell, remote server, phone UI and TV launcher.
- `npm test`: 8 tests passed, including a real headless Edge integration fixture.
- Integration test verified persistent cookie and localStorage after fully closing and reopening Edge with the same profile.
- Integration test verified password metadata detection in a different-origin frame, live text replacement, no password in state JSON, stale-target rejection, Enter delivery, playback detection, pause and seek. An empty parent-page playback hook does not mask the embedded player.
- Native-media routing test verified exactly one media-key callback and no Space key. It does not claim an end-to-end DRM-service or physical headset test.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- Browser visual checks: 390×844 portrait, 320×568 small phone and 844×390 landscape. No horizontal overflow at those sizes. Smaller screens allow vertical scrolling; section navigation remains reachable.
- Synthetic preview checks verified Play/Pause icon changes, automatic search input, live text delivery and landscape control placement.
- Screenshot: `cache/verification/remote-phone.png`. This is clearly labeled synthetic preview data.
- The production tray app was restarted with the updated source and serves the authenticated remote on port 4321.

## Remaining validation boundaries

Windows currently detects the laptop display and a Dell monitor, not Y9. The physical projector/audio handoff and real iPhone software keyboard therefore need room-device verification. Safari can require a tap before opening the keyboard; the panel still appears automatically.

Persistent browser storage was verified with synthetic credentials. Existing passwords were not read or decrypted, and no streaming account was signed in or purchased during verification. Provider sessions can expire independently of Lumen. Users who signed in in their everyday Chrome profile must sign in once in Lumen's dedicated Edge profile.

The remote reports source quality; it does not invent HD/4K readings or bypass provider resolution/DRM limits. HBO's current browser documentation states a 720p maximum. The projector's physical resolution remains a separate limit.

## Design and implementation references

- [Google: TV navigation](https://developer.android.com/training/tv/get-started/navigation)
- [Google: focus system](https://developer.android.com/design/ui/tv/guides/styles/focus-system)
- [Google: TV layout and overscan safety](https://developer.android.com/design/ui/tv/guides/styles/layouts)
- [WebKit: programmatic keyboard focus restrictions](https://bugs.webkit.org/show_bug.cgi?id=195884)
- [Microsoft: media virtual-key codes](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)
- [HBO: supported browsers](https://help.hbomax.com/us/Answer/Detail/000002506)
- [HBO: browser playback limits](https://help.hbomax.com/us-en/answer/detail/000002521)
